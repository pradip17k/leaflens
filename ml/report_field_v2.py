"""Compare frozen versions on the same new development cohort, not the v1 test set."""
import json
import numpy as np
import onnxruntime as ort
from model import read_image
from train_baseline import ROOT, dump

def run():
    output=ROOT/'runs/field-v2/development_comparison.json'
    if output.exists():raise ValueError('Comparison already recorded. Preserve the original result.')
    rows=[r for r in json.loads((ROOT/'field-v2/manifest.json').read_text()) if r['source']=='PlantDoc' and r['split']=='validation']
    result={}
    for version,directory in [('v1','model'),('v2','model-v2')]:
        assets=ROOT.parent/'dist'/directory
        meta=json.loads((assets/'metadata.json').read_text())
        options=ort.SessionOptions();options.intra_op_num_threads=4
        session=ort.InferenceSession(str(assets/'leaflens.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
        known=[];unknown=[]
        for row in rows:
            x=read_image(ROOT/row['path']).astype(np.float32)/255
            x=((x-np.array(meta['mean'],dtype=np.float32))/np.array(meta['std'],dtype=np.float32)).transpose(2,0,1)[None]
            logits=session.run(None,{'images':x})[0][0]/meta['temperature']
            p=np.exp(logits-logits.max());p/=p.sum();label=meta['classes'][int(p.argmax())]
            accepted=label!='unsupported' and float(p.max())>=meta['threshold']
            if row['label']!='unsupported':
                accepted=accepted and label.split('_')[0]==row['label'].split('_')[0]
                known.append(dict(correct=label==row['label'],accepted=accepted))
            else:unknown.append(accepted)
        result[version]=dict(supported_count=len(known),supported_accuracy=sum(x['correct'] for x in known)/len(known),
                            supported_accepted=sum(x['accepted'] for x in known),
                            unsupported_count=len(unknown),unsupported_incorrectly_accepted=sum(unknown),threshold=meta['threshold'])
    report=dict(cohort='PlantDoc train partition, local development-validation subset; not the historical external test set.',
                interpretation='V2 was selected using this development validation, so this comparison is optimistic and not independent proof of improvement.',
                versions=result)
    dump(output,report);dump(ROOT.parent/'dist/model-v2/development_comparison.json',report)
    metrics=json.loads((ROOT/'runs/field-v2/validation_metrics.json').read_text())
    config=json.loads((ROOT/'runs/field-v2/config.json').read_text())
    mite=next(x for x in metrics['per_class'] if x['label']=='tomato_mite_damage')
    md=f'''# LeafLens V2 experimental model

## Status

Working research candidate, selectable alongside V1. **Not field validated.**
V1's 98.37% held-out PlantVillage and 25% historical external results belong to V1 only.
No new untouched test accuracy is claimed for V2.

## What changed

- Frozen ImageNet MobileNetV2 features and a trained 11-output classifier.
- Original nine classes plus tomato spider-mite damage and unsupported condition.
- {config['source_counts']['PlantVillage']} PlantVillage and {config['source_counts']['PlantDoc']} PlantDoc development images.
- Two training views: original and horizontally flipped with contrast variation.
- Fixed 0.8 acceptance threshold; explicit unsupported output and crop mismatches are rejected.
- Non-leaf training included: {config['nonleaf_training_included']}. The optional CIFAR download stalled during this run; no non-leaf rejection accuracy is claimed.

## Development results (used for selection)

Combined validation: {metrics['count']} images, {metrics['accuracy']:.2%} accuracy and {metrics['macro_f1']:.2%} macro-F1.
Selected epoch: {metrics['selected_epoch']}.
Spider-mite damage: {mite['support']} validation images, F1 {mite['f1']:.2%}. This validation class is PlantVillage-only; just two unambiguous PlantDoc mite images were available and both are in training. It does not establish performance on field mite damage or identify insects.

| Same PlantDoc development subset | V1 | V2 |
|---|---:|---:|
| Supported images | {result['v1']['supported_count']} | {result['v2']['supported_count']} |
| Supported-class accuracy | {result['v1']['supported_accuracy']:.2%} | {result['v2']['supported_accuracy']:.2%} |
| Supported predictions accepted | {result['v1']['supported_accepted']} | {result['v2']['supported_accepted']} |
| Unsupported images | {result['v1']['unsupported_count']} | {result['v2']['unsupported_count']} |
| Unsupported inputs incorrectly accepted | {result['v1']['unsupported_incorrectly_accepted']} | {result['v2']['unsupported_incorrectly_accepted']} |

V2 was selected on this development subset; the comparison is optimistic. Acceptance policies differ (V1: 0.5; V2: 0.8), so rejection changes combine model and threshold effects. These numbers must not be compared directly with the historical 36-image external benchmark.

## Data and limitations

PlantDoc publisher train images are split by exact-pixel hash. Ambiguous “Tomato leaf” and “Corn leaf blight” categories are excluded. Exact duplicates of the original PlantVillage manifest and historical external benchmark are excluded. Near-duplicates and common original sources are not fully resolved. New spider-mite splits are image-level, not confirmed independent leaf groups. Internet publisher labels are not independently expert-reviewed.

The explicit unsupported class covers other PlantDoc conditions/crops, not every unsupported input. Non-leaf photos can still receive confident wrong predictions. Independent farm photos, expert review, and robust non-leaf validation remain incomplete. No pesticide advice is provided.

## Reproduce

```powershell
ml/.venv/Scripts/python.exe ml/prepare_field_v2.py
ml/.venv/Scripts/python.exe ml/train_field_v2.py
ml/.venv/Scripts/python.exe ml/report_field_v2.py
```

Use a clean run directory or a new version; training/report commands intentionally refuse to replace existing results. Optional non-leaf preparation is `ml/prepare_nonleaf_v2.py`; including it changes the experiment and requires a new version, not retroactive edits to these scores.

Sources: [PlantDoc (CC BY 4.0)](https://github.com/pratikkayal/PlantDoc-Dataset), [PlantVillage (CC BY-SA 3.0)](https://github.com/spMohanty/PlantVillage-Dataset), [optional CIFAR-10](https://cave.cs.toronto.edu/kriz/cifar.html). Image source revisions and checksums are recorded in `ml/field-v2`. Dataset images are excluded from the repository.
'''
    (ROOT.parent/'dist/model-v2/model-card.md').write_text(md,encoding='utf-8')
    (ROOT.parent/'V2_EXPERIMENT.md').write_text(md,encoding='utf-8')
    print(json.dumps(report,indent=2),flush=True)

if __name__=='__main__':run()
