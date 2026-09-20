"""Download a pinned PlantVillage subset and produce leaf-grouped splits."""
import concurrent.futures as futures
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import random
import shutil
import time
import urllib.parse
import urllib.request
import urllib.error
import argparse
import http.client
import threading

from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
REV = '7f7ecc7e1eaca78107e3affe7cb5abd9427e139a'
REPO = 'spMohanty/PlantVillage-Dataset'
CLASSES = {'healthy': 'Tomato___healthy', 'early': 'Tomato___Early_blight',
           'septoria': 'Tomato___Septoria_leaf_spot'}
SEED = 26131
OUTPUT = ROOT
MULTICROP = False
LEGACY = {'tomato_healthy': 'healthy', 'tomato_early': 'early', 'tomato_septoria': 'septoria'}
CONNECTIONS = threading.local()


def fetch(url):
    for attempt in range(4):
        try:
            parsed = urllib.parse.urlsplit(url)
            if parsed.hostname == 'raw.githubusercontent.com':
                connection = getattr(CONNECTIONS, 'raw', None)
                if connection is None:
                    connection = http.client.HTTPSConnection(parsed.hostname, timeout=30)
                    CONNECTIONS.raw = connection
                connection.request('GET', parsed.path, headers={'User-Agent': 'LeafLens-dataset-preparation'})
                response = connection.getresponse()
                payload = response.read()
                if response.status != 200:
                    raise urllib.error.HTTPError(url, response.status, response.reason, response.headers, None)
                return payload
            req = urllib.request.Request(url, headers={'User-Agent': 'LeafLens-dataset-preparation'})
            with urllib.request.urlopen(req, timeout=60) as response:
                return response.read()
        except Exception as error:
            connection = getattr(CONNECTIONS, 'raw', None)
            if connection is not None:
                connection.close()
                CONNECTIONS.raw = None
            # Missing metadata is handled explicitly by the caller, not retried.
            if isinstance(error, urllib.error.HTTPError) and error.code == 404:
                raise
            if attempt == 3:
                raise
            delay = 2 ** attempt
            if isinstance(error, urllib.error.HTTPError) and error.code in (429, 503):
                retry_after = error.headers.get('Retry-After', '60')
                delay = max(delay, int(retry_after) if retry_after.isdigit() else 60)
            print(f'Retrying request after {type(error).__name__} in {delay}s', flush=True)
            time.sleep(delay)


def raw(path):
    return f'https://raw.githubusercontent.com/{REPO}/{REV}/' + urllib.parse.quote(path)


def tree(ref):
    result = json.loads(fetch(f'https://api.github.com/repos/{REPO}/git/trees/{ref}'))
    if result.get('truncated'):
        raise RuntimeError('Incomplete source listing')
    return result['tree']


def child(entries, name):
    return next(x['sha'] for x in entries if x['path'] == name)


def write_csv(path, rows, fields):
    with path.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def download(item):
    path = DATA / 'raw' / item['label'] / item['filename']
    path.parent.mkdir(parents=True, exist_ok=True)
    legacy = ROOT / 'data/raw' / LEGACY.get(item['label'], '__none__') / item['filename']
    if MULTICROP and not path.exists() and legacy.exists():
        try:
            os.link(legacy, path)
        except OSError:
            shutil.copy2(legacy, path)
    payload = path.read_bytes() if path.exists() else fetch(item['url'])
    git_hash = hashlib.sha1(b'blob ' + str(len(payload)).encode() + b'\0' + payload).hexdigest()
    if git_hash != item['git_sha']:
        raise RuntimeError(f'Source checksum mismatch: {path}')
    if not path.exists():
        path.write_bytes(payload)
    item['sha256'] = hashlib.sha256(payload).hexdigest()
    try:
        with Image.open(io.BytesIO(payload)) as im:
            im.load()
            item['width'], item['height'] = im.size
            rgb = im.convert('RGB')
            item['pixel_sha256'] = hashlib.sha256(str(rgb.size).encode() + rgb.tobytes()).hexdigest()
            if min(im.size) < 128:
                item['exclude'] = 'image_too_small'
    except Exception as exc:
        item['exclude'] = 'decode_error:' + type(exc).__name__
    return item


def prepare():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)
    meta = DATA / 'metadata'
    meta.mkdir(exist_ok=True)
    source_file = meta / 'source_index.json'
    if source_file.exists():
        items = json.loads(source_file.read_text())
    else:
        entries = tree(REV)
        entries = tree(child(entries, 'raw'))
        colors = tree(child(entries, 'color'))
        items = []
        for label, folder in CLASSES.items():
            try:
                mapping_bytes = fetch(raw(f'leaf_grouping/filtered_leafmaps/{folder}.csv'))
            except urllib.error.HTTPError as error:
                if error.code != 404 or not label.startswith('maize_'):
                    raise
                mapping_bytes = b''
            (meta / f'{label}_leafmap.csv').write_bytes(mapping_bytes)
            mapping = {}
            for row in csv.DictReader(io.StringIO(mapping_bytes.decode())):
                key = Path(row['File Name']).stem.strip().lower()
                mapping.setdefault(key, set()).add(row['Leaf #'].strip())
            for entry in tree(child(colors, folder)):
                if entry['type'] != 'blob':
                    continue
                name = entry['path']
                key = Path(name.split('___', 1)[-1]).stem.strip().lower()
                groups = mapping.get(key, set())
                group = label + ':' + next(iter(groups)) if len(groups) == 1 else ''
                grouping = 'publisher_leaf_id'
                if not mapping_bytes and label.startswith('maize_'):
                    group = label + ':image:' + name
                    grouping = 'image_only_provisional'
                items.append(dict(label=label, filename=name, group=group,
                                  grouping=grouping,
                                  git_sha=entry['sha'], url=raw(f'raw/color/{folder}/{name}'),
                                  exclude='' if group else 'missing_or_ambiguous_leaf_group'))
        source_file.write_text(json.dumps(items, indent=2))
    print(f'Downloading/verifying {len(items)} original images', flush=True)
    verified = []
    with futures.ThreadPoolExecutor(max_workers=12) as pool:
        for i, item in enumerate(pool.map(download, items), 1):
            verified.append(item)
            if i % 250 == 0:
                print(f'Images verified: {i}/{len(items)}', flush=True)
    verified.sort(key=lambda x: (x['label'], x['filename']))

    # Union leaf groups linked by identical decoded pixels; detect label conflicts.
    parent = {x['group']: x['group'] for x in verified if x['group']}
    def find(group):
        while parent[group] != group:
            parent[group] = parent[parent[group]]
            group = parent[group]
        return group
    by_pixels = {}
    for item in verified:
        if 'pixel_sha256' in item:
            by_pixels.setdefault(item['pixel_sha256'], []).append(item)
    for same in by_pixels.values():
        if len({x['label'] for x in same}) > 1:
            for item in same:
                item['exclude'] = 'conflicting_duplicate_labels'
        groups = sorted({x['group'] for x in same if x['group']})
        for group in groups[1:]:
            parent[find(group)] = find(groups[0])
    seen = set()
    for item in verified:
        if item['exclude']:
            continue
        item['group'] = find(item['group'])
        if item['pixel_sha256'] in seen:
            item['exclude'] = 'exact_pixel_duplicate'
        seen.add(item['pixel_sha256'])

    # Gallery examples were already seen during development: reserve their whole groups for training.
    gallery = json.loads((ROOT.parent / 'dist/assets/credits.json').read_text(encoding='utf-8-sig'))
    gallery_names = {urllib.parse.unquote(x['source'].rsplit('/', 1)[-1]) for x in gallery}
    forced = {find(x['group']) for x in verified if x['filename'] in gallery_names and x['group']}
    assignments = {}
    for label in CLASSES:
        eligible = [x for x in verified if x['label'] == label and not x['exclude']]
        groups = {}
        for item in eligible:
            groups.setdefault(item['group'], []).append(item)
        keys = sorted(groups)
        random.Random(SEED).shuffle(keys)
        counts = {'train': 0, 'validation': 0, 'test': 0}
        targets = dict(train=len(eligible)*.70, validation=len(eligible)*.15, test=len(eligible)*.15)
        for key in sorted(forced & set(keys)):
            assignments[key] = 'train'
            counts['train'] += len(groups[key])
        for key in keys:
            if key in assignments:
                continue
            split = max(counts, key=lambda s: (targets[s]-counts[s])/max(targets[s], 1))
            assignments[key] = split
            counts[split] += len(groups[key])
        if not all(counts.values()):
            raise RuntimeError(f'Insufficient groups for {label}')

    rows, excluded = [], []
    for item in verified:
        if item['exclude']:
            excluded.append({k: item.get(k, '') for k in ['label', 'filename', 'exclude']})
            continue
        split = assignments[item['group']]
        dest = DATA / 'splits' / split / item['label'] / item['filename']
        dest.parent.mkdir(parents=True, exist_ok=True)
        source = DATA / 'raw' / item['label'] / item['filename']
        if not dest.exists():
            try:
                os.link(source, dest)
            except OSError:
                shutil.copy2(source, dest)
        rows.append(dict(split=split, label=item['label'], group=item['group'],
                         grouping=item.get('grouping', 'publisher_leaf_id'),
                         path=dest.relative_to(ROOT).as_posix(), sha256=item['sha256'],
                         pixel_sha256=item['pixel_sha256'], width=item['width'], height=item['height'],
                         source_url=item['url']))
    for key in ['group', 'sha256', 'pixel_sha256']:
        owners = {}
        for row in rows:
            owners.setdefault(row[key], set()).add(row['split'])
        assert all(len(value) == 1 for value in owners.values()), f'{key} split leakage'
    write_csv(OUTPUT / 'manifest.csv', rows, list(rows[0]))
    write_csv(OUTPUT / 'excluded.csv', excluded, ['label', 'filename', 'exclude'])
    counts = {label: {s: sum(r['label'] == label and r['split'] == s for r in rows)
                      for s in ['train', 'validation', 'test']} for label in CLASSES}
    report = dict(source_commit=REV, seed=SEED, downloaded=len(verified), included=len(rows),
                  excluded=len(excluded), counts=counts, checks='No recorded group, byte-hash, or pixel-hash overlap',
                  grouping_caveat='Maize has no publisher leaf IDs; image-level splits are provisional and may share unrecorded leaves.' if MULTICROP else None,
                  exclusion_reasons={reason: sum(x['exclude'] == reason for x in excluded)
                                     for reason in sorted({x['exclude'] for x in excluded})})
    (OUTPUT / 'dataset_report.json').write_text(json.dumps(report, indent=2))
    (OUTPUT / 'class_names.json').write_text(json.dumps(list(CLASSES), indent=2))
    sheet = Image.new('RGB', (720, len(CLASSES)*160), 'white')
    draw = ImageDraw.Draw(sheet)
    for y, label in enumerate(CLASSES):
        sample = [r for r in rows if r['label'] == label and r['split'] == 'train'][:5]
        for x, row in enumerate(sample):
            with Image.open(ROOT / row['path']) as im:
                sheet.paste(ImageOps.contain(im.convert('RGB'), (140, 130)), (x*144, y*160+25))
        draw.text((5, y*160+5), label, fill='black')
    sheet.save(OUTPUT / 'training_samples.jpg')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--multicrop', action='store_true')
    args = parser.parse_args()
    if args.multicrop:
        MULTICROP = True
        DATA = ROOT / 'data/multicrop-v1'
        OUTPUT = ROOT / 'multicrop-v1'
        CLASSES = {
            'tomato_healthy': 'Tomato___healthy',
            'tomato_early': 'Tomato___Early_blight',
            'tomato_septoria': 'Tomato___Septoria_leaf_spot',
            'potato_healthy': 'Potato___healthy',
            'potato_early': 'Potato___Early_blight',
            'potato_late': 'Potato___Late_blight',
            'maize_healthy': 'Corn_(maize)___healthy',
            'maize_rust': 'Corn_(maize)___Common_rust_',
            'maize_northern_blight': 'Corn_(maize)___Northern_Leaf_Blight',
        }
    prepare()
