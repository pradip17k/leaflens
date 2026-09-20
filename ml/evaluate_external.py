"""Small external PlantDoc benchmark. Never used for training, selection or calibration."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
import hashlib
import io
import json
from pathlib import Path
import urllib.parse

import numpy as np
from PIL import Image
import torch
from model import build_model, read_image, preprocess_for_model, metrics
from train_baseline import ROOT, dump
from prepare_dataset import fetch

REV='5467f6012d78d1c446145d5f582da6096f852ae8'
REPO='pratikkayal/PlantDoc-Dataset'
MAPPING={'Tomato Early blight leaf':'tomato_early','Tomato Septoria leaf spot':'tomato_septoria',
         'Potato leaf early blight':'potato_early','Potato leaf late blight':'potato_late'}
UNSUPPORTED={'Tomato leaf late blight','Tomato leaf bacterial spot','Tomato leaf mosaic virus',
             'Tomato leaf yellow virus','Tomato mold leaf'}
DATA=ROOT/'data/plantdoc-external'
OUT=ROOT/'runs/external-v1'


def download():
    DATA.mkdir(parents=True,exist_ok=True)
    index=DATA/'index.json'
    if index.exists():
        return json.loads(index.read_text())
    tree=json.loads(fetch(f'https://api.github.com/repos/{REPO}/git/trees/{REV}?recursive=1'))
    assert not tree.get('truncated')
    selected=[]
    for entry in tree['tree']:
        parts=entry['path'].split('/')
        if len(parts)!=3 or parts[0]!='test' or entry['type']!='blob':
            continue
        if parts[1] not in MAPPING and parts[1] not in UNSUPPORTED:
            continue
        selected.append(dict(source_path=entry['path'], source_class=parts[1], label=MAPPING.get(parts[1]), git_sha=entry['sha']))
    def get(item):
        url=f'https://raw.githubusercontent.com/{REPO}/{REV}/'+urllib.parse.quote(item['source_path'])
        payload=fetch(url)
        assert hashlib.sha1(b'blob '+str(len(payload)).encode()+b'\0'+payload).hexdigest()==item['git_sha']
        name=item['git_sha']+Path(item['source_path']).suffix.lower()
        (DATA/name).write_bytes(payload)
        item.update(path=str((DATA/name).relative_to(ROOT)).replace('\\','/'),url=url,sha256=hashlib.sha256(payload).hexdigest())
        with Image.open(io.BytesIO(payload)) as im:
            rgb=im.convert('RGB')
            item['pixel_sha256']=hashlib.sha256(str(rgb.size).encode()+rgb.tobytes()).hexdigest()
        return item
    with ThreadPoolExecutor(max_workers=4) as pool:
        records=list(pool.map(get,selected))
    license_bytes=fetch(f'https://raw.githubusercontent.com/{REPO}/{REV}/LICENSE.txt')
    (DATA/'LICENSE.txt').write_bytes(license_bytes)
    dump(index,records)
    print(f'Downloaded {len(records)} external test images.',flush=True)
    return records


def evaluate(records):
    if OUT.exists():
        raise ValueError('External evaluation already exists. Do not tune on this benchmark.')
    torch.set_num_threads(4)
    selection=json.loads((ROOT/'runs/final-v1/selection.json').read_text())
    checkpoint=torch.load(ROOT/'runs'/selection['selected']/'best.pt',weights_only=True,map_location='cpu')
    config=checkpoint['config']; classes=config['class_names']; architecture=config['model']
    model=build_model(architecture,len(classes)).eval();model.load_state_dict(checkpoint['state_dict'])
    pv=list(csv.DictReader((ROOT/'multicrop-v1/manifest.csv').open(newline='',encoding='utf-8')))
    hashes={x['sha256'] for x in pv}; pixels={x['pixel_sha256'] for x in pv}
    seen=set(); used=[]; excluded=[]
    for item in records:
        if item['sha256'] in hashes or item['pixel_sha256'] in pixels or item['pixel_sha256'] in seen:
            excluded.append(item);continue
        seen.add(item['pixel_sha256']);used.append(item)
    results=[]
    for item in used:
        array=read_image(ROOT/item['path'])
        x=torch.from_numpy(array).permute(2,0,1).unsqueeze(0)
        with torch.inference_mode():
            p=(model(preprocess_for_model(x,architecture))/selection['temperature']).softmax(1)[0]
        guess=classes[int(p.argmax())]; confidence=float(p.max())
        crop='potato' if item['source_class'].startswith('Potato') else 'tomato'
        results.append(dict(item,predicted_label=guess,confidence=confidence,
                            accepted=confidence>=selection['threshold'] and guess.startswith(crop+'_')))
    known=[r for r in results if r['label']]
    unknown=[r for r in results if not r['label']]
    score=metrics([classes.index(r['label']) for r in known],[classes.index(r['predicted_label']) for r in known],classes)
    represented=[i for i,c in enumerate(classes) if any(r['label']==c for r in known)]
    score['represented_classes_macro_f1']=float(np.mean([score['per_class'][i]['f1'] for i in represented]))
    accepted=[r for r in known if r['accepted']]
    report=dict(source=f'https://github.com/{REPO}',source_commit=REV,license='CC BY 4.0 as declared by publisher',
                cohort='All publisher test images for four unambiguous overlapping disease classes and five unsupported tomato conditions',
                supported_metrics=score, supported_accepted_count=len(accepted),
                supported_accepted_accuracy=sum(r['label']==r['predicted_label'] for r in accepted)/len(accepted) if accepted else None,
                unsupported_count=len(unknown),unsupported_accepted_count=sum(r['accepted'] for r in unknown),
                exact_duplicates_excluded=len(excluded), used_for_training=False, used_for_tuning=False,
                limitations=['Small internet-sourced cropped-image benchmark, not a prospective farm or phone-photo trial.',
                             'Only four supported disease classes covered; no healthy class or maize coverage.',
                             'Exact duplicates excluded; near-duplicates and original-source overlap cannot be ruled out.',
                             'Publisher labels used without independent agricultural review.'])
    OUT.mkdir(parents=True)
    dump(OUT/'metrics.json',report);dump(OUT/'predictions.json',results);dump(OUT/'excluded.json',excluded)
    dump(ROOT.parent/'dist/model/external_metrics.json',report)
    print(json.dumps(report,indent=2),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--download-only',action='store_true');args=parser.parse_args()
    records=download()
    if not args.download_only:evaluate(records)
