import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interpret,calibratedProbabilities,resizeRGB} from '../dist/inference.mjs';
import {MODEL_LABELS,parsePredictions,evaluatePredictions} from '../dist/core.mjs';

test('nine-class metrics include minority classes and cross-crop errors',()=>{
  const rows=parsePredictions('true_label,predicted_label\npotato_healthy,potato_healthy\nmaize_rust,tomato_early',MODEL_LABELS);
  const m=evaluatePredictions(rows,MODEL_LABELS);
  assert.equal(m.matrix.length,9);assert.equal(m.accuracy,.5);
  assert.equal(m.f1,1/9);assert.equal(m.matrix[7][1],1);
});
test('confidence is numerically stable and a crop mismatch is rejected',()=>{
  const metadata={classes:MODEL_LABELS,temperature:1,threshold:.8,architecture:'test',version:'test'};
  const logits=MODEL_LABELS.map((_,i)=>i===7?1000:0);
  const result=interpret(logits,metadata,'tomato');
  assert.equal(result.label,'maize_rust');assert.equal(result.accepted,false);
  assert.equal(interpret(logits,metadata,'maize').accepted,true);
  assert.ok(Math.abs(calibratedProbabilities([1000,1000]).reduce((a,b)=>a+b)-1)<1e-9);
});
test('uncertainty and malformed outputs cannot masquerade as accepted results',()=>{
  const metadata={classes:MODEL_LABELS,temperature:2,threshold:.8};
  assert.equal(interpret(Array(9).fill(1),metadata,'tomato').accepted,false);
  assert.throws(()=>interpret([1,2],metadata,'tomato'));
  assert.throws(()=>calibratedProbabilities([NaN]));
});
test('browser downsampling matches a Pillow bilinear reference across edges and channels',()=>{
  const pixels=new Uint8Array(17*13*4);
  for(let y=0;y<13;y++)for(let x=0;x<17;x++){for(let c=0;c<3;c++)pixels[(y*17+x)*4+c]=(x*17+y*11+c*61)%256;pixels[(y*17+x)*4+3]=255;}
  const expected=[38,99,160,90,151,202,148,200,87,200,96,72,127,63,124,63,124,185,115,176,169,173,178,55,186,58,97,64,88,149,92,153,200,144,198,90,197,105,69,119,65,126,57,117,178,121,182,178,173,172,59,183,57,97,58,94,155,85,146,205,146,203,96,198,110,65,117,62,122,60,119,180,110,171,194];
  assert.deepEqual(Array.from(resizeRGB(pixels,17,13,5)),expected);
});
