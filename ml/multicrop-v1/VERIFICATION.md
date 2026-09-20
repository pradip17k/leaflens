# Dataset preparation completion

Final verification reviewed on 20 September 2026.

| Crop | Training | Validation | Test | Total |
| --- | ---: | ---: | ---: | ---: |
| Tomato | 2,087 | 455 | 456 | 2,998 |
| Potato | 1,496 | 328 | 328 | 2,152 |
| Maize | 2,336 | 502 | 501 | 3,339 |
| Total | 5,919 | 1,285 | 1,285 | 8,489 |

9,853 source images downloaded; 1,364 excluded for missing or ambiguous leaf-group metadata. All nine classes are represented in every split.

## Checks completed

- Downloaded bytes matched the pinned source Git blob checksums.
- Every included image decoded successfully; manifest dimensions, SHA-256 and decoded-pixel hashes matched the files.
- Split folders matched the manifest exactly, with no extra or missing files.
- No recorded group ID, identical file or identical decoded image crossed splits.
- The original tomato dataset's image membership and split assignments were preserved.
- A contact sheet containing five training examples per class was visually inspected. This was a spot check, not expert validation of all labels.
- Local website crop selection was checked for tomato, potato and maize; the expanded library was visually reviewed. The seven existing core tests passed.

## Limits to retain in the project report

Maize uses provisional image-level IDs because publisher leaf IDs are unavailable. Same-leaf leakage in maize has not been ruled out. Exact-image checks do not detect every near-duplicate or unrecorded relationship.

The inspected maize rust examples have black backgrounds, while healthy and northern blight examples have different framing/backgrounds. A classifier could learn these differences instead of disease features. Use independently collected images for field evaluation and investigate background sensitivity during model evaluation.

Healthy potato has only 152 images, including 24 in its test set. Its performance estimate will be less stable than those of larger classes. Apply any weighting or oversampling to training data only.

## Handoff

Dataset preparation is complete for a development baseline, with the maize limitation above. Model training, confidence calibration, independent field evaluation and real website inference remain separate work. No model accuracy is claimed. Local website edits have not been published to GitHub Pages.
