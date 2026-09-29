"""Write an evidence-based experiment report from saved results, without re-evaluation."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def run(name='field-v3'):
    directory=ROOT/'runs'/name
    assessment=json.loads((directory/'assessment.json').read_text())
    score=assessment['metrics'];metrics=json.loads((directory/'validation_metrics.json').read_text())
    baseline=json.loads((ROOT/'runs/field-v2/development_comparison.json').read_text())['versions']['v2']
    classes=json.loads((directory/'config.json').read_text())['classes']
    predictions=json.loads((ROOT/'runs/field-v2/validation_predictions.json').read_text())
    old_accepted=[r for r in predictions if r['source']=='PlantDoc' and r['true_label']!='unsupported'
                  and r['confidence']>=.8 and r['predicted_label'].split('_')[0]==r['true_label'].split('_')[0]]
    old_precision=sum(r['predicted_label']==r['true_label'] for r in old_accepted)/len(old_accepted)
    checks='\n'.join(f'- {key}: {"pass" if value else "FAIL"}' for key,value in assessment['checks'].items())
    lines='\n'.join(f"| {r['label']} | {r['support']} | {r['recall']:.1%} | {r['f1']:.1%} |" for r in metrics['field_supported']['per_class'] if r['support'])
    decision='Passed the predeclared development gate; eligible as an experimental website option.' if assessment['passes_development_gate'] else 'Failed the predeclared development gate; do not replace the live model.'
    text=f'''# LeafLens V3 accuracy experiment

## Decision

{decision}
**This is development evidence, not independent field validation or a reliable diagnostic claim.**

## Changes tested

V2 mislabeled 42 of its 55 supported PlantDoc development errors as unsupported. V3 uses 224 × 224 inputs (V2: 128 × 128), source/class-balanced loss with extra weight for supported PlantDoc classes, and model selection that prioritizes supported field-style performance instead of the combined dataset average. ImageNet MobileNetV2 feature extraction remains frozen; the classifier is trained on two views of each training photograph.

The same training/validation membership is preserved. No historical test images were used to train or select V3. Development validation was reused after V2, so these comparisons are optimistic. Only five supported classes have field-style validation examples; healthy classes, northern maize blight and mite damage have no field-style validation coverage here.

## Same PlantDoc development images

| Measure | V2 | V3 |
|---|---:|---:|
| Supported images | {baseline['supported_count']} | {score['supported_count']} |
| Supported accuracy | {baseline['supported_accuracy']:.1%} | {score['supported_accuracy']:.1%} |
| Accepted supported predictions | {baseline['supported_accepted']} | {score['supported_accepted']} |
| Accuracy among accepted supported predictions | {old_precision:.1%} | {score['supported_accepted_accuracy']:.1%} |
| Unsupported images | {baseline['unsupported_count']} | {score['unsupported_count']} |
| Unsupported inputs incorrectly accepted | {baseline['unsupported_incorrectly_accepted']} | {score['unsupported_incorrectly_accepted']} |

Both use temperature 1, threshold 0.8 and crop-mismatch rejection for supported inputs. Unsupported false acceptance is conservatively counted whenever any supported class exceeds the threshold. These are model-only results; website photo-quality checks can reduce acceptance further.

### V3 field-style class breakdown

| Class | Images | Recall | F1 |
|---|---:|---:|---:|
{lines}

PlantVillage represented-class development macro-F1: {metrics['plantvillage_macro_f1']:.1%}. Selected epoch: {metrics['selected_epoch']}.

## Predeclared experimental-release checks

Field-style accuracy ≥50%, accepted accuracy ≥80% on at least 20 supported images, no more than 6/324 unsupported false acceptances, and PlantVillage represented-class macro-F1 ≥85%. These thresholds are only regression checks for a research prototype; they are insufficient for agricultural deployment.

{checks}

## Reproduce and inspect

```powershell
ml/.venv/Scripts/python.exe ml/train_field_v3.py
ml/.venv/Scripts/python.exe ml/assess_field_v3.py
ml/.venv/Scripts/python.exe ml/write_v3_report.py
ml/.venv/Scripts/python.exe tests/test_field_selection.py
```

Completed runs are protected against accidental overwrite. Full configuration, history, validation logits and release checks are in `ml/runs/field-v3`; cached features and training checkpoints are excluded from Git. Sources and image checksums remain in `ml/field-v2` and `ml/multicrop-v1`.

## Remaining limitations

No new independent farm cohort or expert labels have been supplied. The model can still be wrong on supported diseases and can accept non-leaf images. Only tomato spider-mite damage is represented for pests; it does not identify insects. Image-level field and mite splits do not rule out related-leaf or source overlap. Internet dataset labels have not been independently reviewed.

Sources: [PlantDoc](https://github.com/pratikkayal/PlantDoc-Dataset) (publisher CC BY 4.0), [PlantVillage](https://github.com/spMohanty/PlantVillage-Dataset) (publisher CC BY-SA 3.0). Original V1 and V2 results are preserved separately.
'''
    if name=='field-v3b':
        text=text.replace('# LeafLens V3 accuracy experiment','# LeafLens V3 follow-up accuracy experiment')
        text=text.replace('## Changes tested','V3 first failed the unsupported-input check (18 false acceptances). This follow-up increases unsupported PlantDoc group weight from 1 to 4 using identical cached features. Both attempts reuse development validation; the original failed result is preserved in V3_EXPERIMENT.md.\n\n## Changes tested')
        text=text.replace('python.exe ml/train_field_v3.py','python.exe ml/train_field_v3b.py').replace('python.exe ml/assess_field_v3.py','python.exe ml/assess_field_v3.py --run field-v3b').replace('python.exe ml/write_v3_report.py','python.exe ml/write_v3_report.py --run field-v3b').replace('`ml/runs/field-v3`','`ml/runs/field-v3b`')
        external=json.loads((directory/'historical_external.json').read_text())
        text=text.replace('## Remaining limitations',f'''## Frozen historical external check

On the same historical PlantDoc cohort used for V1, V3 scored {external['supported_accuracy']:.1%} on {external['supported_count']} supported disease images (V1: 25%). However, it accepted **only {external['supported_accepted']} of those {external['supported_count']}** at threshold 0.8. That single accepted prediction was correct; this is not evidence of 100% real-world accuracy. It accepted {external['unsupported_incorrectly_accepted']} of {external['unsupported_count']} unsupported conditions (V1: 22). Most real-world-style inputs still need expert review.

The checkpoint and threshold were frozen before this check. This is a previously inspected research benchmark, not a fresh blind test. No tuning was performed on this result.

## Remaining limitations''')
    (ROOT.parent/('V3_FOLLOWUP.md' if name=='field-v3b' else 'V3_EXPERIMENT.md')).write_text(text,encoding='utf-8')
    if assessment['passes_development_gate']:
        (ROOT.parent/'dist/model-v3/model-card.md').write_text(text,encoding='utf-8')
    print(decision)

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--run',choices=['field-v3','field-v3b'],default='field-v3');args=parser.parse_args()
    run(args.run)
