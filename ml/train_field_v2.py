"""Train a candidate with public field-style images and an explicit reject class.

Never evaluates the historical test sets. Model selection uses development data.
The candidate is exported separately; it does not overwrite the deployed v1 model.
"""
import csv
import hashlib
import json
import random
import time
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
from model import build_model, read_image, preprocess_for_model, metrics, IMAGE_SIZE
from train_baseline import ROOT, dump, load_split

OUT=ROOT/'runs/field-v2'
ASSETS=ROOT.parent/'dist/model-v2'

def run():
    if (OUT/'status.json').exists():
        raise ValueError('Run already started; preserve it and use a new version for another experiment.')
    OUT.mkdir(parents=True,exist_ok=True)
    random.seed(26132);np.random.seed(26132);torch.manual_seed(26132);torch.set_num_threads(4)
    torch.hub.set_dir(str(ROOT/'data/torch-cache'))
    classes=json.loads((ROOT/'multicrop-v1/class_names.json').read_text())+['tomato_mite_damage','unsupported']
    field=json.loads((ROOT/'field-v2/manifest.json').read_text())
    nonleaf=ROOT/'field-v2/nonleaf_manifest.json'
    if nonleaf.exists():field+=json.loads(nonleaf.read_text())
    pv=list(csv.DictReader((ROOT/'multicrop-v1/manifest.csv').open(encoding='utf-8',newline='')))
    # Balance the source mix without loading or optimizing against historical test images.
    rows=[]
    for label in classes[:9]:
        chosen=sorted([r for r in pv if r['label']==label and r['split']=='train'],key=lambda r:r['sha256'])[:300]
        rows.extend(dict(r,source='PlantVillage') for r in chosen)
    rows.extend(dict(r,source='PlantVillage') for r in pv if r['split']=='validation')
    rows.extend(field)
    config=dict(classes=classes,seed=26132,image_size=IMAGE_SIZE,source_counts={s:sum(r['source']==s for r in rows) for s in ['PlantVillage','PlantDoc','CIFAR10']},
                nonleaf_training_included=nonleaf.exists(),
                selection='Maximum macro F1 on combined development validation; no test evaluation',
                augmentation='Original plus horizontal flip with deterministic brightness/contrast variation',
                architecture='ImageNet MobileNetV2 frozen features; trained linear 11-class head',
                field_manifest_sha256=hashlib.sha256((ROOT/'field-v2/manifest.json').read_bytes()).hexdigest(),
                limitations=json.loads((ROOT/'field-v2/report.json').read_text())['limitations'])
    dump(OUT/'config.json',config);dump(OUT/'status.json',dict(status='extracting',test_evaluated=False))
    model=build_model('MobileNetV2',len(classes),pretrained=True).eval()
    for parameter in model.features.parameters():parameter.requires_grad_(False)
    datasets={}; selected={}
    for split in ['train','validation']:
        data,selected[split]=load_split(rows,classes,split)
        feats=[];labels=[]
        views=2 if split=='train' else 1
        for view in range(views):
            for batch,(x,y) in enumerate(DataLoader(data,batch_size=32)):
                if view:
                    x=x.flip(-1).float()
                    factor=torch.linspace(.7,1.3,len(x)).reshape(-1,1,1,1)
                    x=((x-127.5)*factor+127.5).clamp(0,255).to(torch.uint8)
                with torch.inference_mode():
                    f=model.features(preprocess_for_model(x,'MobileNetV2')).mean((2,3))
                feats.append(f);labels.append(y)
                if batch%30==0:print(f'{split} view {view+1}: batch {batch+1}',flush=True)
        datasets[split]=TensorDataset(torch.cat(feats),torch.cat(labels))
    head=model.classifier
    opt=torch.optim.AdamW(head.parameters(),lr=.001,weight_decay=.001)
    counts=torch.bincount(datasets['train'].tensors[1],minlength=len(classes)).float()
    criterion=nn.CrossEntropyLoss(weight=(counts.sum()/(len(classes)*counts)).sqrt())
    history=[];best=-1;stale=0
    for epoch in range(1,41):
        head.train()
        for x,y in DataLoader(datasets['train'],batch_size=128,shuffle=True):
            opt.zero_grad();loss=criterion(head(x),y);loss.backward();opt.step()
        head.eval()
        with torch.inference_mode(): logits=head(datasets['validation'].tensors[0])
        actual=datasets['validation'].tensors[1];guess=logits.argmax(1)
        score=metrics(actual.tolist(),guess.tolist(),classes)
        history.append(dict(epoch=epoch,accuracy=score['accuracy'],macro_f1=score['macro_f1']))
        if score['macro_f1']>best:
            best=score['macro_f1'];stale=0
            torch.save(dict(state_dict=model.state_dict(),config=config,epoch=epoch),OUT/'best.pt')
        else:stale+=1
        dump(OUT/'history.json',history)
        print(json.dumps(history[-1]),flush=True)
        if stale>=7:break
    checkpoint=torch.load(OUT/'best.pt',weights_only=True,map_location='cpu');model.load_state_dict(checkpoint['state_dict']);model.eval()
    with torch.inference_mode():logits=model.classifier(datasets['validation'].tensors[0])
    actual=datasets['validation'].tensors[1];guess=logits.argmax(1);confidence=logits.softmax(1).max(1).values
    score=metrics(actual.tolist(),guess.tolist(),classes)
    score['by_source']={}
    for source in ['PlantDoc','PlantVillage','CIFAR10']:
        indices=[i for i,r in enumerate(selected['validation']) if r['source']==source]
        score['by_source'][source]=metrics(actual[indices].tolist(),guess[indices].tolist(),classes)
        represented=sorted(set(actual[indices].tolist()))
        score['by_source'][source]['represented_macro_f1']=float(np.mean([score['by_source'][source]['per_class'][i]['f1'] for i in represented])) if represented else None
    # Fixed conservative policy, not fitted to the historical external benchmark.
    threshold=.8
    accepted=(guess!=classes.index('unsupported')) & (confidence>=threshold)
    score['rejection']={}
    for source in ['PlantDoc','CIFAR10']:
        indices=[i for i,r in enumerate(selected['validation']) if r['source']==source and r['label']=='unsupported']
        score['rejection'][source]=dict(count=len(indices),incorrectly_accepted=int(accepted[indices].sum()))
    score.update(split='development_validation',test_evaluated=False,selected_epoch=checkpoint['epoch'],threshold=threshold,
                 accepted_count=int(accepted.sum()),accepted_accuracy=float((actual[accepted]==guess[accepted]).float().mean()) if accepted.any() else None)
    dump(OUT/'validation_metrics.json',score)
    dump(OUT/'validation_predictions.json',[dict(path=r['path'],source=r['source'],true_label=classes[int(a)],predicted_label=classes[int(g)],confidence=float(c)) for r,a,g,c in zip(selected['validation'],actual,guess,confidence)])
    ASSETS.mkdir(exist_ok=True)
    x=torch.zeros(1,3,IMAGE_SIZE,IMAGE_SIZE)
    torch.onnx.export(model,x,str(ASSETS/'leaflens.onnx'),input_names=['images'],output_names=['logits'],opset_version=17,dynamo=False,external_data=False)
    import onnxruntime as ort
    import onnx
    onnx.checker.check_model(str(ASSETS/'leaflens.onnx'))
    session=ort.InferenceSession(str(ASSETS/'leaflens.onnx'),providers=['CPUExecutionProvider'])
    errors=[]
    for row in selected['validation'][:5]:
        x=preprocess_for_model(torch.from_numpy(read_image(ROOT/row['path'])).permute(2,0,1)[None],'MobileNetV2')
        with torch.inference_mode():expected=model(x).numpy()
        observed=session.run(None,{'images':x.numpy()})[0]
        np.testing.assert_allclose(expected,observed,atol=1e-4,rtol=1e-4);errors.append(float(np.max(abs(expected-observed))))
    dump(ASSETS/'metadata.json',dict(version='leaflens-v2-experimental',architecture='MobileNetV2',image_size=IMAGE_SIZE,classes=classes,temperature=1,threshold=threshold,
         mean=[.485,.456,.406],std=[.229,.224,.225],sha256=hashlib.sha256((ASSETS/'leaflens.onnx').read_bytes()).hexdigest(),
         model_bytes=(ASSETS/'leaflens.onnx').stat().st_size,field_validated=False,unknown_image_detector=False,limitations=config['limitations']))
    dump(ASSETS/'validation_metrics.json',score)
    dump(OUT/'export_verification.json',dict(maximum_logit_error=max(errors),validation_samples=5))
    dump(OUT/'status.json',dict(status='complete',test_evaluated=False))
    print('COMPLETE '+json.dumps({k:score[k] for k in ['accuracy','macro_f1','accepted_accuracy']}),flush=True)

if __name__=='__main__':run()
