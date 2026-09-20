# LeafLens V2 experimental model

## Status

Working research candidate, selectable alongside V1. **Not field validated.**
V1's 98.37% held-out PlantVillage and 25% historical external results belong to V1 only.
No new untouched test accuracy is claimed for V2.

## What changed

- Frozen ImageNet MobileNetV2 features and a trained 11-output classifier.
- Original nine classes plus tomato spider-mite damage and unsupported condition.
- 5465 PlantVillage and 2094 PlantDoc development images.
- Two training views: original and horizontally flipped with contrast variation.
- Fixed 0.8 acceptance threshold; explicit unsupported output and crop mismatches are rejected.
- Non-leaf training included: False. The optional CIFAR download stalled during this run; no non-leaf rejection accuracy is claimed.

## Development results (used for selection)

Combined validation: 2017 images, 92.36% accuracy and 92.25% macro-F1.
Selected epoch: 8.
Spider-mite damage: 319 validation images, F1 95.01%. This validation class is PlantVillage-only; just two unambiguous PlantDoc mite images were available and both are in training. It does not establish performance on field mite damage or identify insects.

| Same PlantDoc development subset | V1 | V2 |
|---|---:|---:|
| Supported images | 89 | 89 |
| Supported-class accuracy | 20.22% | 38.20% |
| Supported predictions accepted | 52 | 17 |
| Unsupported images | 324 | 324 |
| Unsupported inputs incorrectly accepted | 232 | 6 |

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
