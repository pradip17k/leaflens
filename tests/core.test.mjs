import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePredictions,evaluatePredictions,inspectPixels,qualityChecks,validateImageFile} from '../dist/core.mjs';

test('asymmetric confusion matrix produces expected per-class and macro metrics',()=>{
  const rows=parsePredictions('true_label,predicted_label\nhealthy,healthy\nhealthy,early\nearly,early\nseptoria,healthy\n');
  const result=evaluatePredictions(rows);
  assert.deepEqual(result.matrix,[[1,1,0],[0,1,0],[1,0,0]]);
  assert.equal(result.accuracy,.5);
  assert.equal(result.precision,1/3);
  assert.equal(result.recall,.5);
  assert.ok(Math.abs(result.f1-7/18)<1e-12);
  assert.deepEqual(result.perClass.map(c=>c.support),[2,1,1]);
});
test('missing classes stay in macro average and never create NaN',()=>{
  const result=evaluatePredictions([{actual:'early',predicted:'early'}]);
  assert.equal(result.accuracy,1);assert.equal(result.f1,1/3);
  assert.ok(result.perClass.every(c=>Number.isFinite(c.f1)));
});
test('CSV tolerates BOM, CRLF, quoted labels and trailing blank lines',()=>{
  assert.deepEqual(parsePredictions('\uFEFFtrue_label,predicted_label\r\n"healthy", healthy\r\n\r\n'),[{actual:'healthy',predicted:'healthy'}]);
});
test('CSV rejects unsupported labels, headers, extra columns and oversized row counts',()=>{
  for(const csv of ['actual,predicted\nhealthy,early','true_label,predicted_label\nearly,unknown','true_label,predicted_label\nhealthy,early,extra','true_label,predicted_label'])assert.throws(()=>parsePredictions(csv));
  assert.throws(()=>parsePredictions('true_label,predicted_label\n'+'healthy,healthy\n'.repeat(10001)),/10,000/);
});
test('file validation rejects unsupported, empty and oversized files',()=>{
  assert.throws(()=>validateImageFile({type:'image/svg+xml',size:100}));
  assert.throws(()=>validateImageFile({type:'image/png',size:0}));
  assert.throws(()=>validateImageFile({type:'image/png',size:10485761}));
  assert.doesNotThrow(()=>validateImageFile({type:'image/jpeg',size:10485760}));
});
test('uniform dark and transparent images trigger appropriate quality review',()=>{
  const black=new Uint8ClampedArray(8*8*4);for(let i=3;i<black.length;i+=4)black[i]=255;
  const stats=inspectPixels(black,8,8);
  assert.equal(stats.brightness,0);assert.equal(stats.texture,0);assert.equal(stats.transparent,0);
  const checks=qualityChecks(stats,256,256);
  assert.deepEqual(checks.map(c=>c.ok),[true,false,false,true]);
  const transparent=inspectPixels(new Uint8ClampedArray(8*8*4),8,8);
  assert.equal(transparent.transparent,1);
  assert.equal(qualityChecks(transparent,256,256)[3].ok,false);
});
test('high contrast opaque image has measurable texture',()=>{
  const pixels=new Uint8ClampedArray(4*4*4);
  for(let i=0;i<16;i++){const v=((i%4)+Math.floor(i/4))%2?220:30;pixels.set([v,v,v,255],i*4);}
  const stats=inspectPixels(pixels,4,4);
  assert.ok(stats.texture>100);assert.ok(stats.brightness>100&&stats.brightness<150);
});
