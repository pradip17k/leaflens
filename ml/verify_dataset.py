"""Offline integrity check of the prepared dataset and its frozen manifest."""
import csv
import hashlib
import json
from pathlib import Path
from PIL import Image
import argparse

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--multicrop', action='store_true')
args = parser.parse_args()
output = root / 'multicrop-v1' if args.multicrop else root
data = root / 'data/multicrop-v1' if args.multicrop else root / 'data'
rows = list(csv.DictReader((output / 'manifest.csv').open(newline='', encoding='utf-8')))
report = json.loads((output / 'dataset_report.json').read_text())
classes = json.loads((output / 'class_names.json').read_text())
assert len(rows) == report['included'] and rows
expected_paths = set()
for row in rows:
    path = root / row['path']
    expected_paths.add(path.resolve())
    assert row['label'] in classes
    assert path.parent.name == row['label'] and path.parent.parent.name == row['split']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256'], path
    with Image.open(path) as image:
        rgb = image.convert('RGB')
        assert rgb.size == (int(row['width']), int(row['height']))
        assert hashlib.sha256(str(rgb.size).encode() + rgb.tobytes()).hexdigest() == row['pixel_sha256']
for key in ['group', 'sha256', 'pixel_sha256']:
    owners = {}
    for row in rows:
        owners.setdefault(row[key], set()).add(row['split'])
    assert all(len(value) == 1 for value in owners.values()), key
actual_paths = {p.resolve() for p in (data / 'splits').rglob('*') if p.is_file()}
assert actual_paths == expected_paths, 'Split folders differ from manifest'
for label in classes:
    for split in ['train', 'validation', 'test']:
        count = sum(r['label'] == label and r['split'] == split for r in rows)
        assert count > 0 and count == report['counts'][label][split]
if args.multicrop and (root / 'manifest.csv').exists():
    original = list(csv.DictReader((root / 'manifest.csv').open(newline='', encoding='utf-8')))
    original_splits = {r['sha256']: r['split'] for r in original}
    tomato = [r for r in rows if r['label'].startswith('tomato_')]
    assert len(tomato) == len(original)
    assert all(original_splits.get(r['sha256']) == r['split'] for r in tomato), 'Tomato split changed'
print(f'PASS: {len(rows)} images verified; {len(classes)} classes in every split; no recorded group or exact-image overlap.')
if report.get('grouping_caveat'):
    print('LIMITATION:', report['grouping_caveat'])
