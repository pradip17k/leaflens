# LeafLens: three crops, nine classes

Preparation and final integrity checks are complete: **8,489 included images**. See [verification results and limitations](VERIFICATION.md).

This version extends dataset preparation to tomato, potato and maize. It preserves the original tomato-only outputs in `ml/` and stores this version's images under `ml/data/multicrop-v1/` (ignored by Git).

| Crop | Labels, in model-output order |
| --- | --- |
| Tomato | tomato_healthy, tomato_early, tomato_septoria |
| Potato | potato_healthy, potato_early, potato_late |
| Maize | maize_healthy, maize_rust, maize_northern_blight |

These represent healthy leaves, early blight and Septoria leaf spot for tomato; healthy leaves, early blight and late blight for potato; healthy leaves, common rust and northern leaf blight for maize. Always use `class_names.json` explicitly: alphabetical folder order differs from this model-output order.

## Source

Original PlantVillage color images at Git revision `7f7ecc7e1eaca78107e3affe7cb5abd9427e139a`:
https://github.com/spMohanty/PlantVillage-Dataset

Attribution: PlantVillage, Mohanty, Hughes and Salathe. Publisher-declared license: CC BY-SA 3.0. See `../source.json` and https://huggingface.co/datasets/mohanty/PlantVillage. Originals are unchanged; the training contact sheet resizes copies. Individual source URLs are recorded in the manifest.

## Split quality and limitations

- **Tomato and potato:** use publisher leaf IDs; exclude missing or ambiguous mappings. Keep each recorded leaf together in one split.
- **Maize:** the publisher's filtered leaf-map directory has no maize files. Use provisional image-level IDs, merging any exact pixel duplicates before splitting. Different photographs of the same leaf may still cross splits. Do not call maize test performance an independent-leaf result. Obtain leaf-level provenance or independently collected field images before making that claim.
- Target proportions: 70% training, 15% validation, 15% testing within each class; seed 26131. Whole groups cause small ratio differences.
- Downloaded images are checked against pinned Git blob hashes, decoded, and checked for minimum dimensions. Exact pixel duplicates are removed, and conflicting duplicate labels excluded.
- Known website example groups go to training when eligible. The contact sheet uses training data only.
- Healthy potato has only 152 source images, compared with about 1,000 in each potato disease class. Use training-only class weighting or sampling; never augment before splitting or duplicate training images into validation/test.
- Known group and exact-image overlap checks do not establish absence of near-duplicates, background bias, source bias, or unrecorded related leaves.

## Files

- `manifest.csv`: paths relative to `ml/`, crop-specific labels, split, grouping method, hashes and original URLs.
- `dataset_report.json`: measured class counts, exclusions and grouping caveat.
- `excluded.csv`: excluded filenames and reasons.
- `class_names.json`: output class ordering.
- `training_samples.jpg`: five examples per class for a visual spot check, not expert relabeling.
- `../data/multicrop-v1/splits/{train,validation,test}/<label>/`: prepared image folders.

Image folders use hard links where available. Do not modify images in place. Source originals and split files may share the same bytes.

## Reproduce and verify

From the project directory, with Python and Pillow installed:

```powershell
python ml/prepare_dataset.py --multicrop
python ml/verify_dataset.py --multicrop
```

The script reuses and rechecks existing tomato downloads. For another dataset version or changed split policy, use a separate output directory. Verification checks file bytes, decoded pixels, counts, folder contents and recorded-group overlap.

## Next: training

Fit on training images, tune on validation images and reserve the test set for a final evaluation. Resize and normalize according to the selected model, and augment training images only. Report macro-F1, per-class precision/recall/F1 and a confusion matrix, plus separate results by crop. No accuracy results exist yet.

The local website now lets users select a crop and view all nine planned classes. Actual disease inference is not connected. Its existing simulated photo examples and CSV evaluation calculator remain explicitly scoped to the three-class tomato pilot; the nine-class evaluation adapter belongs to the model-integration step. This change does not publish the website.
