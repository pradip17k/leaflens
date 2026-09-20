"""Train a scratch CNN on train only; select a checkpoint using validation macro-F1."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
import hashlib
import json
import os
from pathlib import Path
import random
import time

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
from model import LeafCNN, IMAGE_SIZE, read_image, preprocess, metrics

ROOT = Path(__file__).resolve().parent


def dump(path, data):
    path.write_text(json.dumps(data, indent=2), encoding='utf-8')


def load_split(rows, classes, split):
    selected = [r for r in rows if r['split'] == split]
    images = np.empty((len(selected), IMAGE_SIZE, IMAGE_SIZE, 3), dtype=np.uint8)
    def read(row):
        path = ROOT / row['path']
        if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError(f'Image changed since dataset preparation: {path}')
        return read_image(path)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i, image in enumerate(pool.map(read, selected)):
            images[i] = image
    x = torch.from_numpy(images).permute(0, 3, 1, 2).contiguous()
    y = torch.tensor([classes.index(r['label']) for r in selected], dtype=torch.long)
    return TensorDataset(x, y), selected


def augment(images):
    # Training only. The batch shares a rotation; flips and brightness are per image.
    images = images.float().div(255)
    mask = torch.rand(len(images)) < .5
    images[mask] = images[mask].flip(-1)
    mask = torch.rand(len(images)) < .5
    images[mask] = images[mask].flip(-2)
    images = images.rot90(random.randrange(4), (-2, -1))
    brightness = torch.empty(len(images), 1, 1, 1).uniform_(.85, 1.15)
    return (images * brightness).clamp(0, 1).mul(2).sub(1)


@torch.inference_mode()
def evaluate(model, loader, classes):
    model.eval()
    truth, guesses, probabilities = [], [], []
    total_loss = 0
    for images, labels in loader:
        logits = model(preprocess(images))
        total_loss += nn.functional.cross_entropy(logits, labels, reduction='sum').item()
        truth.extend(labels.tolist())
        guesses.extend(logits.argmax(1).tolist())
        probabilities.extend(logits.softmax(1).tolist())
    result = metrics(truth, guesses, classes)
    result['loss'] = total_loss/len(truth)
    return result, truth, guesses, probabilities


def run(args):
    output = ROOT / 'runs' / args.name
    if output.exists():
        raise ValueError('Run directory already exists. Choose a new --name to preserve prior results.')
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(args.threads)
    torch.use_deterministic_algorithms(True)
    manifest = ROOT / 'multicrop-v1/manifest.csv'
    classes = json.loads((manifest.parent / 'class_names.json').read_text())
    rows = list(csv.DictReader(manifest.open(encoding='utf-8', newline='')))
    assert len(classes) == 9 and len(classes) == len(set(classes))
    # Metadata checks cover every split, but test images are never opened.
    for field in ('group', 'sha256', 'pixel_sha256'):
        owners = {}
        for row in rows:
            owners.setdefault(row[field], set()).add(row['split'])
        assert all(len(splits) == 1 for splits in owners.values()), f'{field} overlap'
    for split in ('train', 'validation', 'test'):
        assert {r['label'] for r in rows if r['split'] == split} == set(classes)
    output.mkdir(parents=True)
    started = time.time()
    config = dict(model='LeafCNN', initialized='random; no pretrained weights', image_size=IMAGE_SIZE,
                  resize='RGB, EXIF transpose, bilinear square resize', normalization='pixel / 127.5 - 1',
                  class_names=classes, manifest_sha256=hashlib.sha256(manifest.read_bytes()).hexdigest(),
                  seed=args.seed, epochs_max=args.epochs, patience=args.patience,
                  batch_size=args.batch_size, threads=args.threads, device='cpu',
                  torch_version=str(torch.__version__), numpy_version=np.__version__,
                  learning_rate=.001, weight_decay=.0001, selection='validation macro-F1',
                  training_augmentation='90-degree rotations, horizontal/vertical flips, brightness 0.85-1.15',
                  test_evaluated=False,
                  limitations=['Maize split is image-level; unrecorded same-leaf leakage remains possible.',
                               'Backgrounds differ across maize classes; field generalization is untested.',
                               'Only 104 healthy potato training images; class-weighted training is used.'])
    dump(output / 'config.json', config)
    dump(output / 'status.json', dict(status='loading', test_evaluated=False))
    print('Loading train and validation images; test images will not be read.', flush=True)
    train, _ = load_split(rows, classes, 'train')
    validation, validation_rows = load_split(rows, classes, 'validation')
    counts = torch.bincount(train.tensors[1], minlength=len(classes))
    weights = len(train)/(len(classes)*counts.float())
    config['training_counts'] = counts.tolist()
    config['class_weights'] = weights.tolist()
    dump(output / 'config.json', config)
    generator = torch.Generator().manual_seed(args.seed)
    train_loader = DataLoader(train, batch_size=args.batch_size, shuffle=True, generator=generator)
    validation_loader = DataLoader(validation, batch_size=args.batch_size)
    model = LeafCNN(len(classes))
    print(f'Train={len(train)}; validation={len(validation)}; parameters={sum(p.numel() for p in model.parameters()):,}', flush=True)
    optimizer = torch.optim.AdamW(model.parameters(), lr=.001, weight_decay=.0001)
    criterion = nn.CrossEntropyLoss(weight=weights)
    history, best_f1, best_epoch, stale = [], -1.0, 0, 0
    for epoch in range(1, args.epochs+1):
        tick = time.time()
        model.train()
        train_loss, correct, count = 0.0, 0, 0
        for images, labels in train_loader:
            logits = model(augment(images))
            loss = criterion(logits, labels)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            train_loss += loss.item()*len(labels)
            correct += int((logits.argmax(1) == labels).sum())
            count += len(labels)
        result, _, _, _ = evaluate(model, validation_loader, classes)
        entry = dict(epoch=epoch, train_weighted_loss=train_loss/count, train_accuracy=correct/count,
                     validation_loss=result['loss'], validation_accuracy=result['accuracy'],
                     validation_macro_f1=result['macro_f1'], seconds=round(time.time()-tick, 2))
        history.append(entry)
        if result['macro_f1'] > best_f1:
            best_f1, best_epoch, stale = result['macro_f1'], epoch, 0
            torch.save(dict(state_dict=model.state_dict(), config=config, epoch=epoch), output / 'best.pt')
        else:
            stale += 1
        dump(output / 'history.json', history)
        dump(output / 'status.json', dict(status='training', epoch=epoch, best_epoch=best_epoch,
                                         best_validation_macro_f1=best_f1, test_evaluated=False))
        print(json.dumps(entry), flush=True)
        if stale >= args.patience:
            print(f'Early stopping: no validation macro-F1 improvement for {stale} epochs.', flush=True)
            break
    checkpoint = torch.load(output / 'best.pt', map_location='cpu', weights_only=True)
    model.load_state_dict(checkpoint['state_dict'])
    result, truth, guesses, probabilities = evaluate(model, validation_loader, classes)
    result.update(split='validation', selected_epoch=best_epoch, test_evaluated=False,
                  interpretation='Used for model selection; not an untouched test score.', limitations=config['limitations'])
    dump(output / 'validation_metrics.json', result)
    with (output / 'validation_predictions.csv').open('w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['path', 'true_label', 'predicted_label', 'max_softmax_uncalibrated'])
        for row, actual, guess, probability in zip(validation_rows, truth, guesses, probabilities):
            writer.writerow([row['path'], classes[actual], classes[guess], max(probability)])
    with (output / 'validation_pairs.csv').open('w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['true_label', 'predicted_label'])
        writer.writerows((classes[a], classes[p]) for a, p in zip(truth, guesses))
    dump(output / 'status.json', dict(status='complete', epochs_run=len(history), best_epoch=best_epoch,
                                     seconds=round(time.time()-started, 1), test_evaluated=False))
    print('COMPLETE: ' + str(output), flush=True)
    print(json.dumps({k: result[k] for k in ('accuracy','macro_precision','macro_recall','macro_f1')}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', default='baseline-v1')
    parser.add_argument('--epochs', type=int, default=20)
    parser.add_argument('--patience', type=int, default=5)
    parser.add_argument('--batch-size', type=int, default=64)
    parser.add_argument('--threads', type=int, default=min(4, os.cpu_count() or 1))
    parser.add_argument('--seed', type=int, default=26131)
    args = parser.parse_args()
    if Path(args.name).name != args.name or args.name in ('.', '..'):
        parser.error('--name must be a simple directory name')
    if min(args.epochs, args.patience, args.batch_size, args.threads) < 1:
        parser.error('Numeric settings must be positive')
    run(args)
