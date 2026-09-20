"""Prepare a new development cohort without reusing v1 test images for training.

PlantDoc train supplies domain-shift examples and explicit unsupported conditions.
PlantVillage supplies a narrowly scoped tomato spider-mite damage class.
Publisher test partitions remain quarantined. Image-level splits are provisional.
"""
import csv
import hashlib
import io
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote
from PIL import Image
from prepare_dataset import fetch, tree, child, REV as PV_REV, REPO as PV_REPO
from evaluate_external import REV as PD_REV, REPO as PD_REPO, MAPPING
from train_baseline import ROOT, dump

OUT = ROOT / 'field-v2'
DATA = ROOT / 'data/field-v2'
MITE = 'Tomato___Spider_mites Two-spotted_spider_mite'
FIELD_MAPPING=dict(MAPPING, **{'Corn rust leaf':'maize_rust',
                              'Tomato two spotted spider mites leaf':'tomato_mite_damage'})
AMBIGUOUS={'Corn leaf blight','Tomato leaf'}

def run():
    OUT.mkdir(exist_ok=True); DATA.mkdir(parents=True, exist_ok=True)
    index = DATA / 'source-index.json'
    if index.exists():
        items = json.loads(index.read_text())
    else:
        pd = json.loads(fetch(f'https://api.github.com/repos/{PD_REPO}/git/trees/{PD_REV}?recursive=1'))
        assert not pd.get('truncated')
        items = []
        for e in pd['tree']:
            p = e['path'].split('/')
            if len(p) == 3 and p[0] == 'train' and e['type'] == 'blob':
                items.append(dict(source='PlantDoc', label=MAPPING.get(p[1], 'unsupported'),
                                  source_class=p[1], git_sha=e['sha'],
                                  url=f'https://raw.githubusercontent.com/{PD_REPO}/{PD_REV}/'+quote(e['path'])))
        colors = tree(child(tree(child(tree(PV_REV), 'raw')), 'color'))
        for e in tree(child(colors, MITE)):
            if e['type'] == 'blob':
                items.append(dict(source='PlantVillage', label='tomato_mite_damage', source_class=MITE,
                                  git_sha=e['sha'], url=f'https://raw.githubusercontent.com/{PV_REPO}/{PV_REV}/'+quote('raw/color/'+MITE+'/'+e['path'])))
        dump(index, items)
    # Do not train a healthy/ambiguous supported crop as an unsupported disease.
    items=[dict(item,label=FIELD_MAPPING.get(item['source_class'],'unsupported')) if item['source']=='PlantDoc' else item
           for item in items if item['source_class'] not in AMBIGUOUS]
    def get(item):
        path = DATA / (item['git_sha']+'.image')
        payload = path.read_bytes() if path.exists() else fetch(item['url'])
        assert hashlib.sha1(b'blob '+str(len(payload)).encode()+b'\0'+payload).hexdigest() == item['git_sha']
        path.write_bytes(payload)
        with Image.open(io.BytesIO(payload)) as image:
            rgb = image.convert('RGB')
            pixel = hashlib.sha256(str(rgb.size).encode()+rgb.tobytes()).hexdigest()
        return dict(item, path=path.relative_to(ROOT).as_posix(), sha256=hashlib.sha256(payload).hexdigest(), pixel_sha256=pixel)
    with ThreadPoolExecutor(max_workers=16) as pool:
        records=[]
        for i, record in enumerate(pool.map(get,items)):
            records.append(record)
            if i % 100 == 0: print(f'Downloaded/verified {i+1}/{len(items)}',flush=True)
    pv = list(csv.DictReader((ROOT/'multicrop-v1/manifest.csv').open(encoding='utf-8',newline='')))
    external = json.loads((ROOT/'data/plantdoc-external/index.json').read_text())
    reserved = {r['pixel_sha256'] for r in pv+external}
    seen=set(); kept=[]; excluded=[]
    for r in sorted(records,key=lambda x:x['git_sha']):
        if r['pixel_sha256'] in reserved or r['pixel_sha256'] in seen:
            excluded.append(dict(r,reason='exact_pixel_duplicate')); continue
        seen.add(r['pixel_sha256'])
        # Hash partition keeps duplicate pixels together; not a source/leaf-group guarantee.
        bucket = int(r['pixel_sha256'][:8],16)%100
        r['split'] = 'validation' if bucket < 20 else 'train'
        kept.append(r)
    dump(OUT/'manifest.json',kept); dump(OUT/'excluded.json',excluded)
    counts={}
    for r in kept:
        key=r['source']+'/'+r['label']+'/'+r['split'];counts[key]=counts.get(key,0)+1
    dump(OUT/'report.json',dict(counts=counts,excluded=len(excluded),
         limitations=['Image-level development split; near-duplicate/source overlap not ruled out.',
         'Unsupported means other PlantDoc classes, not a validated non-leaf detector.',
         'Spider-mite class means leaf damage appearance, not insect identification.',
         'No new untouched field test set or expert-confirmed labels.'],
         sources=[dict(repository=PD_REPO,revision=PD_REV,license='CC BY 4.0'),
                  dict(repository=PV_REPO,revision=PV_REV,license='CC BY-SA 3.0')]))
    print(json.dumps(counts,indent=2),flush=True)

if __name__=='__main__': run()
