import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MODEL_LABELS,parsePredictions,evaluatePredictions} from '../dist/core.mjs';
test('deployed model matches metadata and nine-class order',()=>{
  const metadata=JSON.parse(readFileSync(new URL('../dist/model/metadata.json',import.meta.url)));
  const bytes=readFileSync(new URL('../dist/model/leaflens.onnx',import.meta.url));
  assert.deepEqual(metadata.classes,MODEL_LABELS);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.sha256);
  assert.equal(bytes.length,metadata.model_bytes);
  assert.ok(metadata.temperature>0&&metadata.threshold>=0&&metadata.threshold<=1);
  assert.equal(metadata.unknown_image_detector,false);
});
test('published metrics agree with independently recalculated prediction pairs',()=>{
  const metrics=JSON.parse(readFileSync(new URL('../dist/model/test_metrics.json',import.meta.url)));
  const csv=readFileSync(new URL('../dist/model/test_predictions.csv',import.meta.url),'utf8');
  const actual=evaluatePredictions(parsePredictions(csv,MODEL_LABELS),MODEL_LABELS);
  assert.equal(actual.count,metrics.count);assert.deepEqual(actual.matrix,metrics.confusion_matrix);
  for(const [a,b] of [['accuracy','accuracy'],['precision','macro_precision'],['recall','macro_recall'],['f1','macro_f1']])assert.ok(Math.abs(actual[a]-metrics[b])<1e-10);
});
