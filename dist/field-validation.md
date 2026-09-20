# LeafLens field validation protocol

Status: **not completed**. No expert-confirmed farm photographs have been supplied.
Public internet datasets and development-validation scores do not replace this step.

## Collect and review

1. Photograph individual leaves of tomato, potato and maize in normal farm lighting, with different phones, backgrounds, farms and dates. Include healthy leaves, the supported diseases, visually similar unsupported diseases, and non-leaf objects.
2. Obtain permission to use photographs. Exclude faces, personal details and precise location metadata from shared research artifacts.
3. Have a qualified agricultural reviewer assign labels; record uncertain cases as unsupported rather than guessing. Spider-mite damage needs expert confirmation and must not be inferred from generic yellowing.
4. Assign an anonymous leaf group to every photographed leaf and a site group to each collection site. Keep all photos of one leaf and each site in a single partition. Reserve entire new sites for testing.
5. Keep the test images and labels out of training, threshold selection, and demo selection. Freeze model weights and preprocessing before testing. Repeated use turns a test set into development data.

## Local CSV format

Save images below the folder containing a CSV with these headers:

```csv
path,label,leaf_group,site_group,split,expert_confirmed
```

`split`: train, validation, or test. `expert_confirmed`: yes only after actual review.
Use the nine v1 class IDs, `tomato_mite_damage`, `unsupported`, or `non_leaf`.
Do not place expert names or farmer contact details in a public CSV.

Run the local audit:

```powershell
ml/.venv/Scripts/python.exe ml/audit_field_photos.py path/to/field.csv
```

The audit checks missing images, labels, expert-confirmation flags, exact duplicate pixels, and leaf/site overlap. It cannot verify the expert's judgment or detect every near-duplicate.

## Report honestly

Report per-class support, precision, recall, macro-F1, confusion matrix, prediction coverage and accuracy among accepted predictions. Separately report the fraction of unsupported and non-leaf inputs incorrectly accepted. Break results down by site and crop. Include sample sizes and uncertainty intervals; small cohorts do not justify broad accuracy claims.

Define deployment criteria with the project supervisor before looking at test outcomes. If criteria fail, keep the research label, gather additional training data, and reserve a new independent test cohort. Do not prescribe treatment from this prototype.
