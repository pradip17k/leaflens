"""Resolution/domain-balance experiment; all selection scores are development scores.

Keeps V1/V2 assets and historical test cohorts untouched. Cached ImageNet features
make source-balanced training practical on a CPU. No accuracy target is fabricated.
"""
import csv
import hashlib
import json
import random
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps, ImageEnhance
import torch
from torch import nn
from torch.utils.data import Dataset, DataLoader, TensorDataset
from model import build_model, preprocess_for_model, metrics
from train_baseline import ROOT, dump

OUT=ROOT/'runs/field-v3'
SIZE=224
SEED=26133
NEGATIVE_GROUP_WEIGHT=1

class Photos(Dataset):
    def __init__(self,rows,classes,view):self.rows=rows;self.classes=classes;self.view=view
    def __len__(self):return len(self.rows)
    def __getitem__(self,i):
        row=self.rows[i];path=ROOT/row['path']
        if hashlib.sha256(path.read_bytes()).hexdigest()!=row['sha256']:raise ValueError('Source image checksum changed')
        with Image.open(path) as im:
            im=ImageOps.exif_transpose(im).convert('RGB')
            if self.view:
                im=ImageOps.mirror(im)
                im=ImageEnhance.Contrast(im).enhance(.75+(i%11)*.05)
            im=im.resize((SIZE,SIZE),Image.Resampling.BILINEAR)
            x=torch.from_numpy(np.array(im)).permute(2,0,1)
        return x,self.classes.index(row['label'])

def summarize(logits,rows,classes):
    actual=[classes.index(r['label']) for r in rows];guess=logits.argmax(1).tolist()
    result=metrics(actual,guess,classes)
    field=[i for i,r in enumerate(rows) if r['source']=='PlantDoc' and r['label']!='unsupported']
    unknown=[i for i,r in enumerate(rows) if r['source']=='PlantDoc' and r['label']=='unsupported']
    pv=[i for i,r in enumerate(rows) if r['source']=='PlantVillage']
    field_metrics=metrics([actual[i] for i in field],[guess[i] for i in field],classes)
    represented=sorted(set(actual[i] for i in field))
    field_f1=float(np.mean([field_metrics['per_class'][i]['f1'] for i in represented]))
    pv_metrics=metrics([actual[i] for i in pv],[guess[i] for i in pv],classes)
    represented_pv=sorted(set(actual[i] for i in pv))
    pv_f1=float(np.mean([pv_metrics['per_class'][i]['f1'] for i in represented_pv]))
    rejection=sum(guess[i]==classes.index('unsupported') for i in unknown)/len(unknown)
    result.update(field_supported=field_metrics,field_supported_macro_f1=field_f1,
                  unsupported_top1_rejection=rejection,plantvillage_macro_f1=pv_f1,
                  selection_score=.6*field_f1+.2*rejection+.2*pv_f1)
    return result

def run():
    if (OUT/'status.json').exists():raise ValueError('Run exists; preserve results and use a new experiment version.')
    OUT.mkdir(parents=True,exist_ok=True);cache=OUT/'cache';cache.mkdir(exist_ok=True)
    random.seed(SEED);np.random.seed(SEED);torch.manual_seed(SEED);torch.set_num_threads(4)
    torch.hub.set_dir(str(ROOT/'data/torch-cache'))
    classes=json.loads((ROOT/'runs/field-v2/config.json').read_text())['classes']
    field=json.loads((ROOT/'field-v2/manifest.json').read_text())
    pv=list(csv.DictReader((ROOT/'multicrop-v1/manifest.csv').open(encoding='utf-8',newline='')))
    rows=[]
    for label in classes[:9]:
        rows.extend(dict(r,source='PlantVillage') for r in sorted([r for r in pv if r['label']==label and r['split']=='train'],key=lambda r:r['sha256'])[:300])
    rows.extend(dict(r,source='PlantVillage') for r in pv if r['split']=='validation');rows.extend(field)
    config=dict(classes=classes,image_size=SIZE,seed=SEED,architecture='MobileNetV2',
         normalization='ImageNet mean/std; EXIF-correct RGB, Pillow bilinear square resize',
         sampling=f'Each source/class group contributes equal total loss; supported PlantDoc groups have 2x group weight; unsupported PlantDoc weight is {NEGATIVE_GROUP_WEIGHT}x. Loss weights are set before training.',
         selection='0.6 * supported PlantDoc represented-class macro F1 + 0.2 * unsupported PlantDoc top-1 rejection + 0.2 * PlantVillage represented-class macro F1',
         epochs_max=60,patience=12,learning_rate=.001,weight_decay=.001,
         trainable='Linear classifier only; pretrained ImageNet features frozen',
         field_manifest_sha256=hashlib.sha256((ROOT/'field-v2/manifest.json').read_bytes()).hexdigest(),
         baseline_manifest_sha256=hashlib.sha256((ROOT/'multicrop-v1/manifest.csv').read_bytes()).hexdigest(),
         test_evaluated=False,limitations=['Development validation reused after V2; no independent generalization claim.',
         'No validated non-leaf detector; image-level spider-mite/field splits may contain related leaves.',
         'Public dataset labels are not expert-confirmed for this project.'])
    dump(OUT/'config.json',config);dump(OUT/'status.json',dict(status='extracting_features',test_evaluated=False))
    model=build_model('MobileNetV2',len(classes),pretrained=True).eval()
    for p in model.features.parameters():p.requires_grad_(False)
    selected={s:[r for r in rows if r['split']==s] for s in ['train','validation']}
    features={};labels={}
    for split in selected:
        xs=[];ys=[]
        for view in range(2 if split=='train' else 1):
            path=cache/f'{split}-{view}.pt'
            if path.exists():
                saved=torch.load(path,weights_only=True);xs.append(saved['features']);ys.append(saved['labels']);continue
            f=[];y=[]
            for index,(pixels,target) in enumerate(DataLoader(Photos(selected[split],classes,view),batch_size=24)):
                with torch.inference_mode():out=model.features(preprocess_for_model(pixels,'MobileNetV2')).mean((2,3))
                f.append(out);y.append(target)
                if index%25==0:print(f'{split} view {view+1}: {min((index+1)*24,len(selected[split]))}/{len(selected[split])}',flush=True)
            f=torch.cat(f);y=torch.cat(y);torch.save(dict(features=f,labels=y),path);xs.append(f);ys.append(y)
        features[split]=torch.cat(xs);labels[split]=torch.cat(ys)
    groups={}
    for r in selected['train']:
        key=(r['source'],r['label']);groups[key]=groups.get(key,0)+1
    weights=torch.tensor([((NEGATIVE_GROUP_WEIGHT if r['label']=='unsupported' else 2) if r['source']=='PlantDoc' else 1)/groups[(r['source'],r['label'])] for r in selected['train']]).repeat(2)
    weights/=weights.mean()
    loader=DataLoader(TensorDataset(features['train'],labels['train'],weights),batch_size=128,shuffle=True)
    optimizer=torch.optim.AdamW(model.classifier.parameters(),lr=.001,weight_decay=.001)
    history=[];best=-1;stale=0
    for epoch in range(1,61):
        model.classifier.train()
        for x,y,w in loader:
            optimizer.zero_grad(set_to_none=True)
            loss=(nn.functional.cross_entropy(model.classifier(x),y,reduction='none')*w).mean();loss.backward();optimizer.step()
        model.classifier.eval()
        with torch.inference_mode():logits=model.classifier(features['validation'])
        score=summarize(logits,selected['validation'],classes)
        entry=dict(epoch=epoch,selection_score=score['selection_score'],field_accuracy=score['field_supported']['accuracy'],
                   field_macro_f1=score['field_supported_macro_f1'],unknown_rejection=score['unsupported_top1_rejection'],pv_macro_f1=score['plantvillage_macro_f1'])
        history.append(entry);dump(OUT/'history.json',history);print(json.dumps(entry),flush=True)
        if score['selection_score']>best:
            best=score['selection_score'];stale=0
            torch.save(dict(state_dict=model.state_dict(),config=config,epoch=epoch),OUT/'best.pt')
        else:stale+=1
        if stale>=12:break
    checkpoint=torch.load(OUT/'best.pt',weights_only=True);model.load_state_dict(checkpoint['state_dict']);model.eval()
    with torch.inference_mode():logits=model.classifier(features['validation'])
    report=summarize(logits,selected['validation'],classes)
    report.update(split='development_validation',selected_epoch=checkpoint['epoch'],test_evaluated=False)
    dump(OUT/'validation_metrics.json',report)
    dump(OUT/'validation_logits.json',[dict(path=r['path'],source=r['source'],true_label=r['label'],logits=l.tolist()) for r,l in zip(selected['validation'],logits)])
    dump(OUT/'status.json',dict(status='complete',test_evaluated=False))
    print('COMPLETE '+json.dumps({k:report[k] for k in ['selection_score','field_supported_macro_f1','unsupported_top1_rejection']}),flush=True)

if __name__=='__main__':run()
