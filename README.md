# LeafLens — Crop Health Lab (v2)

A responsive, browser-local mini-project prototype for tomato leaf disease screening and model evaluation. No dependencies or API keys are required.

## Run

Requires Node.js 18+.

```sh
node server.cjs
```

Open http://127.0.0.1:4173. The development server listens only on this computer. To stop it, use Ctrl+C.

## Features

- Scanner: drag/drop or browse a JPG, PNG or WebP, preview and enlarge the image.
- Input safeguards: nonempty file, 10 MB limit, decoding, minimum 128 × 128 dimensions and maximum 40 megapixels.
- Quality checks: resolution, average exposure, neighboring-pixel contrast and transparency. Pixel processing uses an aspect-preserving preview up to 256 pixels on the longest side.
- Reference gallery: healthy, early blight and Septoria leaf spot photographs, with explicitly simulated class probabilities.
- Library: symptom search and healthy/disease filters.
- Reports: readable text downloads and print/Save PDF from a report dialog.
- Session history: latest 20 report records, kept only in tab memory, without images.
- Evaluation: CSV import, accuracy, macro precision/recall/F1, confusion matrix, per-class metrics and JSON export.
- Responsive layout, keyboard controls, skip link, native dialogs and reduced-motion support.

## Scope and limitations

**No trained model is connected.** There is no real disease classifier or pest detector. Reference labels come from PlantVillage; displayed probabilities are invented demonstration values and cannot be cited as model results. Uploaded images receive only heuristic quality checks. Those checks do not recognize leaves, diagnose disease, or guarantee suitable images. Quality thresholds have not been validated against a quality dataset.

The evaluation calculator performs real arithmetic on supplied predictions. It cannot verify the model, the dataset, labels or whether a test set was held out. The built-in nine-row example is deliberately labeled as illustrative. A 90% accuracy figure in the methodology is only an initial project target.

## Evaluation CSV

Use exactly two columns and these case-sensitive labels: `healthy`, `early`, `septoria`.

```csv
true_label,predicted_label
healthy,healthy
early,septoria
septoria,septoria
```

Maximum: 1 MB and 10,000 data rows. Optional simple quotes, BOM and CRLF are supported. Extra columns, embedded commas and unknown labels are rejected. A failed import leaves the previous evaluation intact. The downloadable template has headers only to prevent accidentally presenting example rows as measured results.

Confusion matrix rows represent true labels; columns represent predictions. Macro metrics average all three supported classes equally, including missing classes. Undefined precision/recall/F1 values become zero. The dashboard flags absent true-label classes.

## Privacy

Images and CSV files are read in the browser. No application data is sent to an inference service or stored in localStorage. Reloading clears session metadata, image selection and evaluation data. Image object URLs are released on replacement/removal. Only downloaded reports persist when the user saves them.

The stylesheet requests Google Fonts; system fonts are used if unavailable. Reference photos are served from local files.

## Source structure

- `dist/index.html`: semantic app shell
- `dist/styles.css`: responsive theme and print styling
- `dist/app.mjs`: scanner, navigation, dialogs, reports, history and evaluation UI
- `dist/core.mjs`: pure CSV parsing, metric calculations and quality checks
- `dist/data.mjs`: reference descriptions and SVG interface icons
- `dist/assets/`: original reference photographs and exact attribution
- `server.cjs`: dependency-free local server
- `tests/core.test.mjs`: calculation and validation tests

```sh
node --test tests/core.test.mjs
```

## Next phase: train and connect a classifier

1. Choose and license the dataset; deduplicate and group photos by original leaf/source before splitting.
2. Train a baseline CNN and fine-tune MobileNetV2 using identical splits. Apply augmentation only to training images.
3. Save preprocessing, class order and model version with the model.
4. Evaluate an untouched test set plus independent field photos and out-of-scope inputs. Export prediction pairs for this dashboard.
5. Calibrate confidence and select a rejection threshold using validation data, not the test set.
6. Add a model adapter to `analyze()` in `dist/app.mjs`. Map only validated outputs into a new inference report type; keep demo and image-quality reports distinct.
7. Obtain agricultural specialist review before providing actionable treatment recommendations. Pest detection requires its own labeled data and validation.

## Sources

Reference photographs: PlantVillage, Mohanty, Hughes and Salathé, under CC BY-SA 3.0 as declared by the publisher's dataset card. Files are unchanged; presentation dimensions vary.

- Dataset: https://github.com/spMohanty/PlantVillage-Dataset
- Publisher card and license: https://huggingface.co/datasets/mohanty/PlantVillage
- License: https://creativecommons.org/licenses/by-sa/3.0/
- Exact file attribution: `dist/assets/credits.json`
- Symptom reference: https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/yard-and-garden-problems/tomato-leaf-spot-diseases

SIH26131 is supplied by the project brief; affiliation and official status have not been verified.

## GitHub Pages deployment

The included `.github/workflows/pages.yml` tests the project and publishes only `dist/` using GitHub Pages. In the destination repository, select **Settings → Pages → Source → GitHub Actions** before the first deployment. Push to `main` or run **Test and publish LeafLens** manually from Actions. The deployment environment reports the actual website URL after a successful run.

The site uses relative asset URLs and hash navigation, so it supports repository subpaths on GitHub Pages. The Node preview server is not deployed. Do not present the site as a trained diagnostic system; the prototype labels remain visible after deployment.
