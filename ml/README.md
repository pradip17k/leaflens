# LeafLens dataset — step 1

**Expanded version:** [three crops / nine classes](multicrop-v1/README.md). Use `--multicrop` with the preparation and verification scripts for that version. The original tomato-only dataset described below is preserved.

## Scope

One crop: **tomato**. Three labels, matching the existing website:

| Model index | Website label | Meaning | PlantVillage folder |
| --- | --- | --- | --- |
| 0 | healthy | Healthy tomato leaf | Tomato___healthy |
| 1 | early | Tomato early blight | Tomato___Early_blight |
| 2 | septoria | Tomato Septoria leaf spot | Tomato___Septoria_leaf_spot |

Use the explicit order in `class_names.json` when training and exporting; directory loaders may otherwise sort alphabetically. This dataset does not support pest recognition, other crops, or other tomato diseases. Healthy means the source dataset's healthy class, not proof that an entire plant is disease free.

## Source and attribution

PlantVillage, Mohanty, Hughes and Salathe:

- https://github.com/spMohanty/PlantVillage-Dataset
- Pinned source commit: `7f7ecc7e1eaca78107e3affe7cb5abd9427e139a`
- Publisher dataset card: https://huggingface.co/datasets/mohanty/PlantVillage
- Publisher-declared image license: CC BY-SA 3.0; https://creativecommons.org/licenses/by-sa/3.0/
- Paper: https://doi.org/10.3389/fpls.2016.01419

Original color images are retained unchanged. Attribution and source URLs are recorded in `manifest.csv`. Resizing is used only for the sample contact sheet. Keep attribution and the applicable image license when redistributing images or adaptations. No image dataset is published by the website deployment.

## Preparation decisions

1. Download only the three original color classes; do not mix segmented/grayscale versions or pre-augmented datasets into the splits.
2. Verify downloaded bytes against the pinned Git blob checksums and decode every image with Pillow. Flag images below 128 pixels on either side.
3. Match original filenames to the publisher's leaf-group CSVs. Exclude images with missing or ambiguous group metadata instead of assuming each photo depicts a different leaf.
4. Merge known leaf groups connected by identical decoded images. Exclude conflicting duplicate labels and remove repeated exact pixel copies.
5. Allocate complete groups separately within each class, targeting 70% training, 15% validation and 15% testing. Seed: 26131. Counts are approximate because groups stay intact.
6. Keep any eligible website gallery image's entire group in training, since those examples have already been seen during development.
7. Verify no group ID, file SHA-256 or decoded-pixel SHA-256 appears in multiple splits.

This checks known leaf groups and exact duplicates. It does not prove that all visually similar images or unrecorded related leaves have been found. Excluding missing metadata can introduce selection bias; the report makes those exclusions visible.

## Outputs

- `dataset_report.json`: actual counts, source revision and exclusion summary.
- `manifest.csv`: frozen image paths, labels, splits, groups, hashes and source URLs.
- `excluded.csv`: every excluded image and reason.
- `class_names.json`: explicit model output order.
- `training_samples.jpg`: visual spot-check sheet, training images only.
- `data/raw/<label>/`: unchanged source images.
- `data/splits/{train,validation,test}/<label>/`: training-ready folders (hard links where supported; copies otherwise). Do not edit images in place, because hard links share bytes with originals.
- `data/metadata/`: downloaded leaf maps and source file index.

## Reproduce

Requires Python 3 and Pillow (`python -m pip install Pillow==12.3.0`).

```powershell
python ml/prepare_dataset.py
python ml/verify_dataset.py
```

The preparation command downloads public files and is resumable: previously downloaded bytes are reverified. The first run needs internet access and roughly a few hundred MB of free disk space. `ml/data/` is excluded from Git. Preserve the manifest and source revision with each model experiment. If changing classes or split policy, use a new versioned dataset directory rather than mixing outputs with the current one.

## Rules for the next step

- Fit models using **train** only; apply augmentation dynamically only to that split.
- Use **validation** for model choice, early stopping and confidence thresholds.
- Keep **test** untouched until the model and settings are fixed. Do not choose a model based on its test results.
- Resize/normalize at model input time according to the chosen architecture. Do not pre-normalize the saved JPGs.
- Later collect independently labeled phone/field photos and unrelated images for a separate evaluation. PlantVillage results alone do not measure field reliability or non-leaf rejection.
- No accuracy has been measured yet. Dataset preparation is complete only after the report and verification succeed; model training is a separate step.
