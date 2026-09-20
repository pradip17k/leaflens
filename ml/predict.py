"""Run the exported model on one local photo; no upload or server required."""
import argparse
import json
from pathlib import Path
import numpy as np
import onnxruntime as ort
from model import read_image

root=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('image',type=Path)
parser.add_argument('--crop',choices=['tomato','potato','maize'],required=True)
args=parser.parse_args()
metadata=json.loads((root/'dist/model/metadata.json').read_text())
rgb=read_image(args.image).astype(np.float32)/255
x=((rgb-np.array(metadata['mean'],dtype=np.float32))/np.array(metadata['std'],dtype=np.float32)).transpose(2,0,1)[None]
session=ort.InferenceSession(str(root/'dist/model/leaflens.onnx'),providers=['CPUExecutionProvider'])
logits=session.run(None,{'images':x})[0][0]/metadata['temperature']
p=np.exp(logits-logits.max());p/=p.sum();i=int(p.argmax());label=metadata['classes'][i]
print(json.dumps(dict(label=label,confidence=float(p[i]),accepted=bool(p[i]>=metadata['threshold'] and label.startswith(args.crop+'_')),
    model=metadata['architecture'],note='Research prediction. This CLI does not apply the website capture-quality gates. Unsupported images may receive confident wrong predictions.'),indent=2))
