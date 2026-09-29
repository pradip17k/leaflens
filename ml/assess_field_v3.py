"""Apply fixed development-only release checks; do not tune using historical tests."""
import hashlib
import json
import numpy as np
import torch
from model import build_model, preprocess_for_model
from train_baseline import ROOT, dump
from train_field_v3 import Photos

OUT=ROOT/'runs/field-v3'
ASSETS=ROOT.parent/'dist/model-v3'
# Defined before the candidate's training results are inspected.
POLICY=dict(threshold=.8,min_field_accuracy=.50,min_field_accepted_accuracy=.80,
            min_field_accepted_count=20,max_unsupported_accepted=6,min_pv_macro_f1=.85)

def assess(records,classes):
    known=[];unknown=[]
    for row in records:
        if row['source']!='PlantDoc':continue
        logits=np.array(row['logits']);p=np.exp(logits-logits.max());p/=p.sum()
        label=classes[int(p.argmax())];accepted=label!='unsupported' and float(p.max())>=POLICY['threshold']
        if row['true_label']=='unsupported':unknown.append(accepted)
        else:
            accepted=accepted and label.split('_')[0]==row['true_label'].split('_')[0]
            known.append(dict(correct=label==row['true_label'],accepted=accepted))
    accepted=[r for r in known if r['accepted']]
    return dict(supported_count=len(known),supported_accuracy=sum(r['correct'] for r in known)/len(known),
                supported_accepted=len(accepted),supported_accepted_accuracy=sum(r['correct'] for r in accepted)/len(accepted) if accepted else 0,
                unsupported_count=len(unknown),unsupported_incorrectly_accepted=sum(unknown))

def run():
    if (OUT/'assessment.json').exists():raise ValueError('Assessment exists; preserve the original experiment.')
    torch.set_num_threads(4)
    config=json.loads((OUT/'config.json').read_text());classes=config['classes']
    records=json.loads((OUT/'validation_logits.json').read_text())
    score=assess(records,classes);metrics=json.loads((OUT/'validation_metrics.json').read_text())
    checks=dict(field_accuracy=score['supported_accuracy']>=POLICY['min_field_accuracy'],
                accepted_accuracy=score['supported_accepted_accuracy']>=POLICY['min_field_accepted_accuracy'],
                coverage=score['supported_accepted']>=POLICY['min_field_accepted_count'],
                unsupported_errors=score['unsupported_incorrectly_accepted']<=POLICY['max_unsupported_accepted'],
                plantvillage_regression=metrics['plantvillage_macro_f1']>=POLICY['min_pv_macro_f1'])
    assessment=dict(policy=POLICY,checks=checks,passes_development_gate=all(checks.values()),metrics=score,
                    interpretation='Development criteria only; this does not establish reliable farm performance or independent test accuracy.')
    dump(OUT/'assessment.json',assessment)
    print(json.dumps(assessment,indent=2),flush=True)
    if not assessment['passes_development_gate']:return
    ASSETS.mkdir(exist_ok=True)
    checkpoint=torch.load(OUT/'best.pt',weights_only=True,map_location='cpu')
    model=build_model('MobileNetV2',len(classes));model.load_state_dict(checkpoint['state_dict']);model.eval()
    size=config['image_size']
    torch.onnx.export(model,torch.zeros(1,3,size,size),str(ASSETS/'leaflens.onnx'),input_names=['images'],output_names=['logits'],opset_version=17,dynamo=False,external_data=False)
    import onnx
    import onnxruntime as ort
    onnx.checker.check_model(str(ASSETS/'leaflens.onnx'))
    session=ort.InferenceSession(str(ASSETS/'leaflens.onnx'),providers=['CPUExecutionProvider'])
    field=json.loads((ROOT/'field-v2/manifest.json').read_text())
    selected=[r for r in field if r['source']=='PlantDoc' and r['split']=='validation'][:5]
    dataset=Photos(selected,classes,0);errors=[]
    for pixels,_ in dataset:
        x=preprocess_for_model(pixels[None],'MobileNetV2')
        with torch.inference_mode():expected=model(x).numpy()
        actual=session.run(None,{'images':x.numpy()})[0]
        np.testing.assert_allclose(actual,expected,atol=1e-4,rtol=1e-4);errors.append(float(np.max(np.abs(actual-expected))))
    weights=(ASSETS/'leaflens.onnx').read_bytes()
    dump(ASSETS/'metadata.json',dict(version='leaflens-v3-experimental',architecture='MobileNetV2',image_size=size,classes=classes,
         temperature=1,threshold=POLICY['threshold'],mean=[.485,.456,.406],std=[.229,.224,.225],sha256=hashlib.sha256(weights).hexdigest(),model_bytes=len(weights),
         field_validated=False,unknown_image_detector=False,limitations=config['limitations']))
    dump(ASSETS/'assessment.json',assessment);dump(ASSETS/'validation_metrics.json',metrics)
    dump(OUT/'export_verification.json',dict(maximum_logit_error=max(errors),validation_samples=len(errors)))

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--run',choices=['field-v3','field-v3b'],default='field-v3');args=parser.parse_args()
    OUT=ROOT/'runs'/args.run
    run()
