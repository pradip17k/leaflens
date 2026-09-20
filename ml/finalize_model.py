"""Freeze selection on validation, calibrate there, evaluate test once, export browser assets."""
import csv
import hashlib
import json
from pathlib import Path
import time
import numpy as np
import torch
from torch.utils.data import DataLoader
from model import build_model, preprocess_for_model, metrics, IMAGE_SIZE
from train_baseline import ROOT, load_split, dump


@torch.inference_mode()
def logits_for(model, dataset, architecture):
    return torch.cat([model(preprocess_for_model(x, architecture)) for x, _ in DataLoader(dataset, batch_size=32)])


def main():
    torch.set_num_threads(4)
    output = ROOT / 'runs/final-v1'
    if output.exists():
        raise ValueError('Final evaluation already exists; do not silently repeat test-based development.')
    candidates = []
    for name in ('baseline-v1', 'mobilenet-v1'):
        run = ROOT / 'runs' / name
        assert json.loads((run / 'status.json').read_text())['status'] == 'complete'
        score = json.loads((run / 'validation_metrics.json').read_text())
        candidates.append(dict(run=name, validation_accuracy=score['accuracy'], validation_macro_f1=score['macro_f1']))
    selected = max(candidates, key=lambda x: x['validation_macro_f1'])
    checkpoint = torch.load(ROOT / 'runs' / selected['run'] / 'best.pt', weights_only=True, map_location='cpu')
    config = checkpoint['config']
    classes, architecture = config['class_names'], config['model']
    manifest = ROOT / 'multicrop-v1/manifest.csv'
    assert hashlib.sha256(manifest.read_bytes()).hexdigest() == config['manifest_sha256']
    rows = list(csv.DictReader(manifest.open(newline='', encoding='utf-8')))
    model = build_model(architecture, len(classes)).eval()
    model.load_state_dict(checkpoint['state_dict'])
    validation, _ = load_split(rows, classes, 'validation')
    logits = logits_for(model, validation, architecture)
    targets = validation.tensors[1]
    temperatures = [.5, .75, 1, 1.25, 1.5, 2, 3, 5]
    temperature = min(temperatures, key=lambda t: torch.nn.functional.cross_entropy(logits/t, targets).item())
    probs = (logits/temperature).softmax(1)
    scores, guesses = probs.max(1)
    policies = []
    for threshold in np.arange(.5, .991, .01):
        accepted = scores >= threshold
        count = int(accepted.sum())
        accuracy = float((guesses[accepted] == targets[accepted]).float().mean()) if count else 0
        if count >= 100 and accuracy >= .95:
            policies.append(dict(threshold=round(float(threshold), 2), count=count, accuracy=accuracy))
    policy = max(policies, key=lambda p:p['count']) if policies else dict(threshold=.99, count=0, accuracy=None)
    output.mkdir(parents=True)
    # Persist selection before any test image is opened.
    selection = dict(selected=selected['run'], comparisons=candidates, temperature=temperature,
                     threshold=policy['threshold'], validation_acceptance=policy,
                     threshold_rule='Maximum validation coverage with >=95% observed accuracy and >=100 samples, grid 0.50..0.99; fallback 0.99',
                     caveat='In-distribution validation calibration only; not reliable unknown-image detection.')
    dump(output / 'selection.json', selection)
    print('Selection frozen:', json.dumps(selection), flush=True)
    test, test_rows = load_split(rows, classes, 'test')
    test_logits = logits_for(model, test, architecture)
    test_probs = (test_logits/temperature).softmax(1)
    confidence, predictions = test_probs.max(1)
    actual = test.tensors[1]
    report = metrics(actual.tolist(), predictions.tolist(), classes)
    accepted = confidence >= policy['threshold']
    report.update(split='test', model=architecture, selected_run=selected['run'], temperature=temperature,
                  threshold=policy['threshold'], acceptance_count=int(accepted.sum()),
                  acceptance_coverage=float(accepted.float().mean()),
                  accepted_accuracy=float((predictions[accepted] == actual[accepted]).float().mean()) if accepted.any() else None,
                  field_evaluated=False, unknown_image_detector=False, limitations=config['limitations'])
    report['by_crop'] = {}
    for crop in ('tomato','potato','maize'):
        indices = [i for i, label in enumerate(classes) if label.startswith(crop+'_')]
        mask = torch.tensor([int(x) in indices for x in actual])
        report['by_crop'][crop] = dict(count=int(mask.sum()), accuracy=float((predictions[mask] == actual[mask]).float().mean()),
                                      macro_f1=float(np.mean([report['per_class'][i]['f1'] for i in indices])))
    dump(output / 'test_metrics.json', report)
    with (output / 'test_predictions.csv').open('w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['true_label','predicted_label'])
        writer.writerows((classes[a], classes[p]) for a,p in zip(actual.tolist(),predictions.tolist()))
    assets = ROOT.parent / 'dist/model'
    assets.mkdir(exist_ok=True)
    sample = preprocess_for_model(validation.tensors[0][:1], architecture)
    torch.onnx.export(model, sample, str(assets / 'leaflens.onnx'), input_names=['images'], output_names=['logits'],
                      opset_version=17, dynamo=False, external_data=False)
    import onnx
    import onnxruntime as ort
    onnx.checker.check_model(str(assets / 'leaflens.onnx'))
    session = ort.InferenceSession(str(assets / 'leaflens.onnx'), providers=['CPUExecutionProvider'])
    maximum_error = 0
    for i in range(9):
        x = preprocess_for_model(validation.tensors[0][i:i+1], architecture)
        with torch.inference_mode():
            expected = model(x).numpy()
        observed = session.run(None, {'images':x.numpy()})[0]
        maximum_error = max(maximum_error, float(np.max(np.abs(expected-observed))))
        np.testing.assert_allclose(observed, expected, atol=1e-4, rtol=1e-4)
    model_hash = hashlib.sha256((assets / 'leaflens.onnx').read_bytes()).hexdigest()
    metadata = dict(version='leaflens-v1', architecture=architecture, image_size=IMAGE_SIZE, classes=classes,
                    temperature=temperature, threshold=policy['threshold'], normalization=config['normalization'],
                    mean=[.485,.456,.406] if architecture=='MobileNetV2' else [.5,.5,.5],
                    std=[.229,.224,.225] if architecture=='MobileNetV2' else [.5,.5,.5],
                    sha256=model_hash, model_bytes=(assets / 'leaflens.onnx').stat().st_size,
                    field_validated=False, unknown_image_detector=False, limitations=config['limitations'])
    dump(assets / 'metadata.json', metadata)
    dump(assets / 'test_metrics.json', report)
    dump(assets / 'comparison.json', selection)
    (assets / 'test_predictions.csv').write_bytes((output / 'test_predictions.csv').read_bytes())
    # Reproducible degradation/invalid-input probes; these are not independent field data.
    probes = {}
    for name, pixels in [('black',np.zeros((1,3,IMAGE_SIZE,IMAGE_SIZE),dtype=np.uint8)),
                         ('white',np.full((1,3,IMAGE_SIZE,IMAGE_SIZE),255,dtype=np.uint8)),
                         ('noise',np.random.default_rng(26131).integers(0,256,(1,3,IMAGE_SIZE,IMAGE_SIZE),dtype=np.uint8))]:
        with torch.inference_mode():
            p = (model(preprocess_for_model(torch.from_numpy(pixels), architecture))/temperature).softmax(1)[0]
        probes[name] = dict(prediction=classes[int(p.argmax())], confidence=float(p.max()), accepted_by_confidence_only=bool(p.max()>=policy['threshold']))
    dump(output / 'invalid_input_probes.json', probes)
    dump(output / 'export_verification.json', dict(onnx_valid=True, validation_samples=9, maximum_logit_error=maximum_error, sha256=model_hash))
    dump(output / 'status.json', dict(status='complete', test_evaluated=True, field_evaluated=False))
    print('FINAL:', json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
