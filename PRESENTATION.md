# LeafLens presentation outline

1. **Problem:** Farmers need timely investigation of visible crop symptoms. Explain the project as limited screening support.
2. **Scope:** Three crops, nine classes; show the exact supported conditions. Pest detection is outside this model.
3. **Data:** Explain 70/15/15 splits, leaf grouping, class imbalance and the maize metadata limitation.
4. **Models:** Show the compact CNN and MobileNetV2 comparison. Explain transfer learning and why validation chooses the checkpoint.
5. **Results:** Use measured tables from PROJECT_REPORT.md. Label validation, reserved test and external PlantDoc results separately.
6. **Demonstration:** Select crop, upload a leaf, run browser inference, download a report, show uncertainty and measured evaluation results. Reference demo scores are simulated; use “Run the real model on this photo” to demonstrate inference.
7. **Real-world gap:** Explain external errors, background bias and why confidence cannot reliably identify unsupported inputs.
8. **Next work:** Expert-labeled farm photos, independent maize grouping, representative negatives and a properly evaluated unknown-input detector.

Do not describe dataset accuracy as accuracy on all farm photos. The strongest technical story is an honest comparison with reproducible data and a visible generalization gap.
