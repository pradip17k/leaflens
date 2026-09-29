"""Follow-up after V3 failed unsupported-input gate: 4x negative group weight.

Reuses identical cached input features; leaves the failed V3 experiment intact.
"""
import hashlib
import json
import shutil
import train_field_v3 as experiment
from train_baseline import ROOT, dump

def run():
    previous=ROOT/'runs/field-v3'
    config=json.loads((previous/'config.json').read_text())
    for file,key in [('field-v2/manifest.json','field_manifest_sha256'),('multicrop-v1/manifest.csv','baseline_manifest_sha256')]:
        if hashlib.sha256((ROOT/file).read_bytes()).hexdigest()!=config[key]:raise ValueError('Cached feature source changed')
    output=ROOT/'runs/field-v3b'
    if output.exists():raise ValueError('Follow-up run exists; do not overwrite')
    cache=output/'cache';cache.mkdir(parents=True)
    for name in ['train-0.pt','train-1.pt','validation-0.pt']:
        shutil.copyfile(previous/'cache'/name,cache/name)
    dump(output/'experiment_note.json',dict(parent='field-v3',change='Unsupported PlantDoc group loss weight 1 to 4',
         reason='V3 passed supported accuracy/coverage checks but falsely accepted 18 unsupported examples; release limit is 6.',
         reused_features=True,validation_is_development=True))
    experiment.OUT=output;experiment.NEGATIVE_GROUP_WEIGHT=4
    experiment.run()

if __name__=='__main__':run()
