"""One frozen-model check on the historical 77-image external cohort.

This benchmark has been inspected for V1. It is not a newly collected blind test.
Do not change the candidate or threshold in response to this result.
"""
import json
import numpy as np
import torch
import onnxruntime as ort
from train_baseline import ROOT, dump
from train_field_v3 import Photos
from model import preprocess_for_model

def run():
    out=ROOT/'runs/field-v3b/historical_external.json'
    if out.exists():raise ValueError('Historical check already recorded; preserve it.')
    assets=ROOT.parent/'dist/model-v3'
    meta=json.loads((assets/'metadata.json').read_text());classes=meta['classes']
    records=json.loads((ROOT/'runs/external-v1/predictions.json').read_text())
    rows=[dict(r,label=r['label'] or 'unsupported') for r in records]
    options=ort.SessionOptions();options.intra_op_num_threads=4
    session=ort.InferenceSession(str(assets/'leaflens.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
    predictions=[]
    for row,(pixels,target) in zip(rows,Photos(rows,classes,0)):
        x=preprocess_for_model(pixels[None],'MobileNetV2').numpy()
        logits=session.run(None,{'images':x})[0][0];p=np.exp(logits-logits.max());p/=p.sum()
        label=classes[int(p.argmax())]
        crop='potato' if row['source_class'].startswith('Potato') else 'tomato'
        accepted=label.startswith(crop+'_') and float(p.max())>=meta['threshold']
        predictions.append(dict(path=row['path'],true_label=row['label'],predicted_label=label,confidence=float(p.max()),accepted=accepted))
    supported=[r for r in predictions if r['true_label']!='unsupported']
    unknown=[r for r in predictions if r['true_label']=='unsupported']
    accepted=[r for r in supported if r['accepted']]
    report=dict(cohort='Same historical PlantDoc external cohort used for V1; four supported disease classes and five unsupported tomato conditions.',
        supported_count=len(supported),supported_accuracy=sum(r['true_label']==r['predicted_label'] for r in supported)/len(supported),
        supported_accepted=len(accepted),supported_accepted_accuracy=sum(r['true_label']==r['predicted_label'] for r in accepted)/len(accepted) if accepted else None,
        unsupported_count=len(unknown),unsupported_incorrectly_accepted=sum(r['accepted'] for r in unknown),
        threshold=meta['threshold'],model_sha256=meta['sha256'],model_frozen_before_check=True,
        limitations=['Previously inspected benchmark, not a new blind or prospective farm trial.',
                     'Small cohort and only four supported disease classes; no healthy, maize or pest coverage.',
                     'Exact overlap was excluded during preparation; near-duplicates and publisher labeling errors remain possible.'])
    # Predefined historical regression comparison with V1; not a tuning objective.
    report['passes_historical_regression']=report['supported_accuracy']>=.25 and report['unsupported_incorrectly_accepted']<=22
    dump(out,report);dump(out.with_name('historical_external_predictions.json'),predictions)
    dump(assets/'historical_external.json',report)
    print(json.dumps(report,indent=2),flush=True)

if __name__=='__main__':run()
