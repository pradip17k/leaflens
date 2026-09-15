# LeafLens — Crop Health Lab

A browser-based mini-project prototype for tomato leaf disease screening.

## Run locally

Requires Node.js 18 or newer. No packages are needed.

```sh
node server.cjs
```

Open http://127.0.0.1:4173.

## Implemented

- Responsive scanner, reference library, evaluation plan and project definition.
- Local JPG/PNG/WebP preview with file type, 10 MB size limit, decoding and dimension checks.
- Three preset demo scenarios with downloadable JSON reports.
- Images remain in browser memory and are not sent to a server or stored persistently.
- Optional WebMCP tool for staging demo cases in supporting browsers.

## Honest scope

There is no trained model, inference service, real classification, pest detector or measured accuracy in this prototype. Sample confidence values are explicitly simulated. Uploads receive only an image readability check. The 90% accuracy figure is a target. Image checks cannot determine whether a picture contains a leaf.

## Model integration plan

1. Collect licensed, labeled images; deduplicate and group original leaf/source images before splitting.
2. Train a baseline CNN and fine-tune MobileNetV2 using training and validation sets only.
3. Save the exact preprocessing, class order and model version with each model.
4. Evaluate once on held-out data: per-class precision/recall/F1, macro F1, accuracy, confusion matrix and latency. Include independent field photos and out-of-scope images.
5. Connect an inference API or browser-compatible model in `analyze()` in `dist/app.js`. Replace the upload-only result with actual probabilities, model version and validation-selected rejection thresholds. Do not map arbitrary uploads to sample cases.
6. Have agricultural guidance reviewed before real deployment.

## Structure

- `dist/index.html`: application shell and metadata
- `dist/styles.css`: responsive visual design
- `dist/app.js`: all state, navigation and interactions
- `server.cjs`: local preview server

The app uses Google Fonts when reachable, with system font fallbacks. No API keys are needed.
