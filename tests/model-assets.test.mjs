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

test('experimental model has separate integrity, class order and development-only metrics',()=>{
  const metadata=JSON.parse(readFileSync(new URL('../dist/model-v2/metadata.json',import.meta.url)));
  const bytes=readFileSync(new URL('../dist/model-v2/leaflens.onnx',import.meta.url));
  const metrics=JSON.parse(readFileSync(new URL('../dist/model-v2/validation_metrics.json',import.meta.url)));
  assert.deepEqual(metadata.classes,[...MODEL_LABELS,'tomato_mite_damage','unsupported']);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.sha256);
  assert.equal(bytes.length,metadata.model_bytes);
  assert.equal(metadata.field_validated,false);
  assert.equal(metrics.test_evaluated,false);
  assert.equal(metrics.split,'development_validation');
  assert.equal(metrics.confusion_matrix.flat().reduce((a,b)=>a+b,0),metrics.count);
});

test('V3 weights pass integrity and published release checks without claiming field validation',()=>{
  const metadata=JSON.parse(readFileSync(new URL('../dist/model-v3/metadata.json',import.meta.url)));
  const bytes=readFileSync(new URL('../dist/model-v3/leaflens.onnx',import.meta.url));
  const assessment=JSON.parse(readFileSync(new URL('../dist/model-v3/assessment.json',import.meta.url)));
  const external=JSON.parse(readFileSync(new URL('../dist/model-v3/historical_external.json',import.meta.url)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.sha256);
  assert.equal(metadata.model_bytes,bytes.length);assert.equal(metadata.image_size,224);
  assert.deepEqual(metadata.classes,[...MODEL_LABELS,'tomato_mite_damage','unsupported']);
  assert.equal(metadata.field_validated,false);assert.equal(metadata.unknown_image_detector,false);
  assert.equal(assessment.passes_development_gate,true);
  assert.ok(Object.values(assessment.checks).every(Boolean));
  assert.equal(external.model_sha256,metadata.sha256);
  assert.ok(external.supported_accepted<=external.supported_count);
});
