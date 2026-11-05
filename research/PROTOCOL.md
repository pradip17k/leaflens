# Risk-aware crop disease triage: current implementation and next experiment

## Built in this upgrade

- Reuses V1–V3, preprocessing, quality checks and the existing tomato reference guidance.
- Shared, dependency-free numerical functions for temperature-scaled probabilities, LAC and deterministic APS, calibration metrics, risk–coverage and unknown-detection AUROC.
- Three explicit triage actions. Image quality takes precedence; unsupported/crop-mismatch inputs require expert review. Basic guidance requires an explicitly enabled independent-evidence profile bound to the model hash and class order and a curated knowledge entry. No such profile is enabled for V1–V3.
- A browser Reliability lab and deterministic CLI audit on the saved V3 development logits. No training or historical external test data is modified.
- Meaningful numerical and policy regression tests, included in the existing test runner and CI.

## What has NOT been demonstrated

No improved field accuracy, new trained model, independent risk guarantee, reliable non-leaf rejection or agronomic action validity. Conformal sets run in the offline audit only. The live model scores remain the original V3 outputs. A metadata flag asserting independent evidence is an engineering configuration, not a statistical proof.

## Audit conventions

`node research/audit-reliability.mjs` writes `dist/research/reliability-audit.json`. It uses source/class-stratified deterministic partitions of the saved `field-v3b/validation_logits.json`: approximately 35% temperature fitting, 35% conformal calibration, and the remainder audit. IDs and input bytes have recorded hashes. Partitions are image-based, not proven leaf-independent. All examples previously influenced model selection, so the report is explicitly development-only.

Scalar temperature minimizes NLL on a fixed log grid from 0.1 to 10, including 1. Conformal calibration uses only supported true classes; candidate sets span the existing model vocabulary including the unsupported output. This output does not represent every possible unknown disease. Alpha is fixed at 0.1. LAC score is 1 minus class probability. APS uses the deterministic cumulative probability through the candidate's rank, ties assigned a cumulative block score. Sets directly invert those scores; empty sets are permitted. This convention differs from variants that always include the threshold-crossing label. The order statistic is ceil((n+1)(1-alpha)); insufficient calibration returns the full label space. Marginal coverage requires exchangeability and calibration independent of model fitting/selection, not established for this retrospective audit.

ECE uses 15 equal-width top-confidence bins, the rightmost including confidence 1. Brier sums squared error across all model classes before averaging examples. NLL uses stable log-sum-exp. Null metrics denote unavailable evidence, never zero error on no accepted samples. Risk–coverage uses all known audit records, including unsupported top-1 errors, with tied scores accepted together and right-step integration. Chart points are downsampled; AURC uses the full curve. Policy tables additionally apply known crop matching and unsupported-output rejection; they are different analyses from the confidence-only curve. Unknown false acceptance conservatively counts any accepted supported crop. AUROC has unknown as positive; MSP and max logit are negated, energy is not. Unknown types were seen in development, not blind unseen-disease classes. No image-quality gate is applied to saved logits.

## Next experiment, required before enabling guidance

1. Freeze crop/class mapping and collect an appropriately licensed source/field manifest. Keep original leaf/capture groups together; audit exact/near duplicates and document unresolved identities.
2. Reserve training, model-selection, temperature-fitting, conformal-calibration, policy-development and final-test roles before training. Use separate unknown-development and unknown-test disease classes where possible. Existing development records cannot retroactively become a blind test.
3. Retrain a lightweight backbone with the fixed protocol. Compare a frozen-feature alternative only if compute permits. Save logits for every untouched evaluation record.
4. Compare forced classification, raw confidence rejection, calibrated confidence rejection, LAC/APS policies and the combined unknown-aware policy at matched accepted coverage. Source-only and field-calibrated conditions must disclose different supervision.
5. Report class/domain counts, calibration, set coverage/size, risk–coverage, unknown operating points, review/recapture burden and uncertainty intervals. Do not retune on the final test. Choose risk and useful coverage targets on development data before final evaluation.
6. Independently inspect the resulting policy and curated guidance. Enable only a matching model-bound profile with documented evidence. Do not infer action correctness from disease labels alone.

## Primary methodological references

- Guo et al., calibration and temperature scaling: https://proceedings.mlr.press/v70/guo17a.html
- Angelopoulos and Bates, split conformal principles and limitations: https://arxiv.org/abs/2107.07511
- Romano et al., adaptive classification sets: https://arxiv.org/abs/2006.02544
- Liu et al., energy-based OOD scoring: https://arxiv.org/abs/2010.03759

The existing V3 historical external result remains 50% classification accuracy and 1/36 supported predictions accepted. That result does not establish the usefulness of an automatic guidance policy.
