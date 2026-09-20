"""Fine-tune MobileNetV2's final convolution block and classifier on cached frozen features."""
import argparse
import csv
import hashlib
import json
import random
import time

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
from model import build_model, IMAGE_SIZE, preprocess_for_model, metrics
from train_baseline import ROOT, load_split, dump


@torch.inference_mode()
def extract(backbone, dataset, flip=False):
    output = []
    for index, (images, labels) in enumerate(DataLoader(dataset, batch_size=32)):
        if flip:
            images = images.flip(-1)
        output.append(backbone(preprocess_for_model(images, 'MobileNetV2')))
        if index % 50 == 0:
            print(f'Feature batches processed: {index+1}; flip={flip}', flush=True)
    return torch.cat(output)


@torch.inference_mode()
def evaluate(head, loader, classes):
    head.eval()
    truth, guesses, probs, loss = [], [], [], 0
    for features, labels in loader:
        logits = head(features)
        loss += nn.functional.cross_entropy(logits, labels, reduction='sum').item()
        truth.extend(labels.tolist())
        guesses.extend(logits.argmax(1).tolist())
        probs.extend(logits.softmax(1).tolist())
    result = metrics(truth, guesses, classes)
    result['loss'] = loss/len(truth)
    return result, truth, guesses, probs


def run(args):
    output = ROOT / 'runs' / args.name
    if output.exists():
        raise ValueError('Run already exists; select another --name.')
    random.seed(26131)
    np.random.seed(26131)
    torch.manual_seed(26131)
    torch.set_num_threads(4)
    torch.use_deterministic_algorithms(True)
    torch.hub.set_dir(str(ROOT / 'data/torch-cache'))
    manifest = ROOT / 'multicrop-v1/manifest.csv'
    classes = json.loads((manifest.parent / 'class_names.json').read_text())
    rows = list(csv.DictReader(manifest.open(encoding='utf-8', newline='')))
    # Same manifest as the baseline; independent verification has already passed.
    baseline_config = json.loads((ROOT / 'runs/baseline-v1/config.json').read_text())
    assert hashlib.sha256(manifest.read_bytes()).hexdigest() == baseline_config['manifest_sha256']
    output.mkdir(parents=True)
    start = time.time()
    config = dict(baseline_config, model='MobileNetV2', initialized='IMAGENET1K_V2',
                  normalization='ImageNet mean [0.485,0.456,0.406], std [0.229,0.224,0.225]',
                  training_augmentation='One original and one horizontal-flip view per training image; no validation augmentation',
                  learning_rate=.0005, epochs_max=args.epochs, patience=5, batch_size=128,
                  trainable='Final convolution block features[18] and classifier; preceding backbone frozen in eval mode')
    dump(output / 'config.json', config)
    dump(output / 'status.json', dict(status='extracting_features', test_evaluated=False))
    model = build_model('MobileNetV2', len(classes), pretrained=True)
    backbone = nn.Sequential(*list(model.features.children())[:-1]).eval()
    for parameter in backbone.parameters():
        parameter.requires_grad_(False)
    train, _ = load_split(rows, classes, 'train')
    validation, val_rows = load_split(rows, classes, 'validation')
    print('Extracting training original views', flush=True)
    train_a = extract(backbone, train)
    print('Extracting training flip views', flush=True)
    train_b = extract(backbone, train, flip=True)
    print('Extracting validation views', flush=True)
    val_features = extract(backbone, validation)
    labels = train.tensors[1]
    counts = torch.bincount(labels, minlength=len(classes))
    weights = len(labels)/(len(classes)*counts.float())
    train_data = TensorDataset(torch.cat([train_a, train_b]), labels.repeat(2))
    val_data = TensorDataset(val_features, validation.tensors[1])
    del train, validation, train_a, train_b
    head = nn.Sequential(model.features[-1], nn.AdaptiveAvgPool2d(1), nn.Flatten(), model.classifier)
    optimizer = torch.optim.AdamW(head.parameters(), lr=.0005, weight_decay=.0001)
    criterion = nn.CrossEntropyLoss(weight=weights)
    loader = DataLoader(train_data, batch_size=128, shuffle=True, generator=torch.Generator().manual_seed(26131))
    val_loader = DataLoader(val_data, batch_size=128)
    history, best, best_epoch, stale = [], -1, 0, 0
    for epoch in range(1, args.epochs+1):
        tick = time.time()
        head.train()
        total, correct, count = 0, 0, 0
        for features, targets in loader:
            logits = head(features)
            loss = criterion(logits, targets)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            total += loss.item()*len(targets)
            correct += int((logits.argmax(1) == targets).sum())
            count += len(targets)
        result, _, _, _ = evaluate(head, val_loader, classes)
        entry = dict(epoch=epoch, train_weighted_loss=total/count, train_accuracy=correct/count,
                     validation_accuracy=result['accuracy'], validation_loss=result['loss'],
                     validation_macro_f1=result['macro_f1'], seconds=round(time.time()-tick, 2))
        history.append(entry)
        if result['macro_f1'] > best:
            best, best_epoch, stale = result['macro_f1'], epoch, 0
            torch.save(dict(state_dict=model.state_dict(), config=config, epoch=epoch), output / 'best.pt')
        else:
            stale += 1
        dump(output / 'history.json', history)
        dump(output / 'status.json', dict(status='training', epoch=epoch, best_epoch=best_epoch, test_evaluated=False))
        print(json.dumps(entry), flush=True)
        if stale >= 5:
            break
    checkpoint = torch.load(output / 'best.pt', weights_only=True, map_location='cpu')
    model.load_state_dict(checkpoint['state_dict'])
    result, truth, guesses, probs = evaluate(head, val_loader, classes)
    result.update(split='validation', selected_epoch=best_epoch, test_evaluated=False,
                  interpretation='Used for model selection; not an untouched test score.', limitations=config['limitations'])
    dump(output / 'validation_metrics.json', result)
    with (output / 'validation_predictions.csv').open('w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['path','true_label','predicted_label','max_softmax_uncalibrated'])
        for row, actual, guess, probability in zip(val_rows, truth, guesses, probs):
            writer.writerow([row['path'], classes[actual], classes[guess], max(probability)])
    dump(output / 'status.json', dict(status='complete', epochs_run=len(history), best_epoch=best_epoch,
                                     seconds=round(time.time()-start, 1), test_evaluated=False))
    print('TRANSFER COMPLETE', flush=True)
    print(json.dumps({k:result[k] for k in ('accuracy','macro_f1')}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', default='mobilenet-v1')
    parser.add_argument('--epochs', type=int, default=15)
    args = parser.parse_args()
    from pathlib import Path
    if Path(args.name).name != args.name or args.name in ('.', '..') or args.epochs < 1:
        parser.error('Invalid run name or epoch count')
    run(args)
