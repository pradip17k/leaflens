# LeafLens — three-crop research classifier

A static website with real browser-local inference for tomato, potato and maize across nine crop-specific classes. A compact CNN and pretrained MobileNetV2 are compared using the same validation split; the selected model is exported to ONNX.

See [measured results and architecture](PROJECT_REPORT.md), [presentation outline](PRESENTATION.md), and [dataset verification](ml/multicrop-v1/VERIFICATION.md). Dataset performance is not a claim of general farm-photo accuracy.

## Run

Requires Node.js 18+. No npm installation is needed; the pinned runtime is vendored.

```powershell
node server.cjs
```

Open http://127.0.0.1:4173. Select a crop, upload a photo and choose **Analyze leaf**. Images stay on your device. Runtime/model files download from this website; Google Fonts may make a separate font request.

The three tomato reference demos retain explicitly simulated values. Choose **Run the real model on this photo** for actual inference. Session reports, text downloads, printing, nine-class CSV evaluation and a **Measured results** button are included.

## Classes and input limits

| Crop | Model labels |
| --- | --- |
| Tomato | tomato_healthy, tomato_early, tomato_septoria |
| Potato | potato_healthy, potato_early, potato_late |
| Maize | maize_healthy, maize_rust, maize_northern_blight |

The website accepts JPG/PNG/WebP, up to 10 MB, at least 128 pixels per side and at most 40 megapixels. Capture heuristics can withhold predictions, but cannot establish that an image is a supported leaf. Unsupported diseases and non-leaf images may receive confident incorrect predictions.

CSV columns must be exactly `true_label,predicted_label`, with the labels above; maximum 1 MB and 10,000 rows. Confusion-matrix rows are true labels. Macro metrics include all nine classes, with undefined divisions set to zero. Legacy three-label pure functions remain for compatibility; the website uses nine labels.

## Reproduce

Python 3.12 was used. Create an isolated environment:

```powershell
python -m venv ml/.venv
ml/.venv/Scripts/python.exe -m pip install -r ml/training-requirements.txt
ml/.venv/Scripts/python.exe ml/prepare_dataset.py --multicrop
ml/.venv/Scripts/python.exe ml/verify_dataset.py --multicrop
ml/.venv/Scripts/python.exe ml/train_baseline.py
ml/.venv/Scripts/python.exe ml/train_transfer.py
ml/.venv/Scripts/python.exe ml/finalize_model.py
ml/.venv/Scripts/python.exe ml/evaluate_external.py
ml/.venv/Scripts/python.exe ml/vendor_runtime.py
ml/.venv/Scripts/python.exe ml/write_report.py
```

Run directories are protected against overwrites. In a checkout containing saved reports, use a separate experiment workspace and new run names, updating the fixed comparison names for a new experiment. Do not retune against the reserved test or external benchmark.

Training images, Python environment and PyTorch checkpoints are excluded from Git. ONNX weights, measured reports, manifests and code are included. Training runs on CPU with four threads. MobileNet's preceding blocks are frozen; its final convolution block and classifier are fine-tuned on cached features. Only training data is augmented or weighted. Hardware and library changes can affect reproducibility.

Local CLI prediction (without the website capture-quality gate):

```powershell
ml/.venv/Scripts/python.exe ml/predict.py path/to/leaf.jpg --crop tomato
```

## Verification

```powershell
node --test tests/core.test.mjs tests/inference.test.mjs tests/model-assets.test.mjs
```

If Windows sandboxing blocks test subprocesses, run each file directly with Node. Dataset checks cover hashes, labels, folder contents and recorded-group overlap. ONNX export is compared against PyTorch on nine validation tensors. Browser downsampling matches a Pillow reference using the same bilinear coefficient rounding. Decoder/color-management differences may still cause small variation.

## Evidence limits

- Maize has no publisher leaf IDs. Its provisional image-level split may share unrecorded leaves, and backgrounds differ by class.
- Healthy potato has only 104 training and 24 test images.
- A small external PlantDoc cohort covers four supported diseases and five unsupported tomato conditions. It is internet-sourced, not a prospective farm trial.
- Exact duplicates are checked; near-duplicates, source overlap and label noise cannot be ruled out.
- Independent farm/phone-photo trials, expert review and a trained unknown-input detector remain future research work.
- Pest identification and pesticide prescriptions are outside scope. SIH26131 is user-supplied; official affiliation is unverified.

## Deployment and attribution

GitHub Actions tests the assets and publishes only `dist/` to GitHub Pages. Training data and Python are not deployed. Relative paths support repository subpaths.

PlantVillage: Mohanty, Hughes and Salathe, publisher-declared CC BY-SA 3.0. PlantDoc: Singh et al., publisher-declared CC BY 4.0. Revisions and source URLs are recorded in manifests and the report. ONNX Runtime Web 1.23.2 is vendored with its MIT license and registry integrity record. MobileNetV2 uses Torchvision IMAGENET1K_V2 weights. Existing photo credits are in `dist/assets/credits.json`.
