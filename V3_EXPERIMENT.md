# LeafLens V3 accuracy experiment

## Decision

Failed the predeclared development gate; do not replace the live model.
**This is development evidence, not independent field validation or a reliable diagnostic claim.**

## Changes tested

V2 mislabeled 42 of its 55 supported PlantDoc development errors as unsupported. V3 uses 224 × 224 inputs (V2: 128 × 128), source/class-balanced loss with extra weight for supported PlantDoc classes, and model selection that prioritizes supported field-style performance instead of the combined dataset average. ImageNet MobileNetV2 feature extraction remains frozen; the classifier is trained on two views of each training photograph.

The same training/validation membership is preserved. No historical test images were used to train or select V3. Development validation was reused after V2, so these comparisons are optimistic. Only five supported classes have field-style validation examples; healthy classes, northern maize blight and mite damage have no field-style validation coverage here.

## Same PlantDoc development images

| Measure | V2 | V3 |
|---|---:|---:|
| Supported images | 89 | 89 |
| Supported accuracy | 38.2% | 68.5% |
| Accepted supported predictions | 17 | 34 |
| Accuracy among accepted supported predictions | 94.1% | 97.1% |
| Unsupported images | 324 | 324 |
| Unsupported inputs incorrectly accepted | 6 | 18 |

Both use temperature 1, threshold 0.8 and crop-mismatch rejection for supported inputs. Unsupported false acceptance is conservatively counted whenever any supported class exceeds the threshold. These are model-only results; website photo-quality checks can reduce acceptance further.

### V3 field-style class breakdown

| Class | Images | Recall | F1 |
|---|---:|---:|---:|
| tomato_early | 10 | 30.0% | 33.3% |
| tomato_septoria | 25 | 76.0% | 79.2% |
| potato_early | 11 | 36.4% | 34.8% |
| potato_late | 22 | 63.6% | 66.7% |
| maize_rust | 21 | 100.0% | 100.0% |

PlantVillage represented-class development macro-F1: 93.3%. Selected epoch: 27.

## Predeclared experimental-release checks

Field-style accuracy ≥50%, accepted accuracy ≥80% on at least 20 supported images, no more than 6/324 unsupported false acceptances, and PlantVillage represented-class macro-F1 ≥85%. These thresholds are only regression checks for a research prototype; they are insufficient for agricultural deployment.

- field_accuracy: pass
- accepted_accuracy: pass
- coverage: pass
- unsupported_errors: FAIL
- plantvillage_regression: pass

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
