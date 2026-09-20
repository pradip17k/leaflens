"""Audit an expert-labeled local field CSV before any training or evaluation.

Does not upload images, modify the CSV, or claim diagnostic validation.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageOps

LABELS={'tomato_healthy','tomato_early','tomato_septoria','potato_healthy','potato_early',
        'potato_late','maize_healthy','maize_rust','maize_northern_blight','tomato_mite_damage',
        'unsupported','non_leaf'}
REQUIRED={'path','label','leaf_group','site_group','split','expert_confirmed'}

def audit(csv_path):
    base=csv_path.resolve().parent
    with csv_path.open(newline='',encoding='utf-8-sig') as handle:
        reader=csv.DictReader(handle)
        if not REQUIRED.issubset(reader.fieldnames or []):raise ValueError('Missing required CSV columns: '+', '.join(sorted(REQUIRED)))
        rows=list(reader)
    errors=[];groups={};sites={};pixels={};counts={}
    if not rows:errors.append('No labeled photographs supplied.')
    for i,row in enumerate(rows,2):
        prefix=f'Row {i}: '
        if row['label'] not in LABELS:errors.append(prefix+'unsupported label')
        if row['split'] not in {'train','validation','test'}:errors.append(prefix+'invalid split')
        if row['expert_confirmed'].strip().lower()!='yes':errors.append(prefix+'expert confirmation required')
        for key,index in [('leaf_group',groups),('site_group',sites)]:
            group=row[key].strip()
            if not group:errors.append(prefix+key+' is required');continue
            if group in index and index[group]!=row['split']:errors.append(prefix+key+' crosses splits')
            index[group]=row['split']
        path=(base/row['path']).resolve()
        if not path.is_relative_to(base) or not row['path']:errors.append(prefix+'photo must be inside the CSV folder');continue
        try:
            with Image.open(path) as image:
                rgb=ImageOps.exif_transpose(image).convert('RGB')
                digest=hashlib.sha256(str(rgb.size).encode()+rgb.tobytes()).hexdigest()
                if min(rgb.size)<128:errors.append(prefix+'image smaller than 128 pixels')
            if digest in pixels:errors.append(prefix+'duplicate photograph')
            pixels[digest]=row['split']
        except (OSError,ValueError):errors.append(prefix+'image missing or unreadable')
        key=row['split']+'/'+row['label'];counts[key]=counts.get(key,0)+1
    return dict(valid=not errors,count=len(rows),counts=counts,errors=errors,
                note='Checks metadata and exact pixels only. Expert truth, consent, near-duplicates and representative sampling require human review.')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('csv',type=Path);args=parser.parse_args()
    result=audit(args.csv);print(json.dumps(result,indent=2));raise SystemExit(0 if result['valid'] else 1)
