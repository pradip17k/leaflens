// Exercise the actual application handlers with a minimal DOM adapter.
// Browser layout and WASM inference are checked separately in the browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
globalThis.File??=File;

const elements=new Map(),documentEvents=new Map(),windowEvents=new Map();
function element(selector){
  if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:'',value:'',dataset:{},handlers:new Map(),classList:{toggle(){},add(){},remove(){}},addEventListener(name,fn){this.handlers.set(name,fn);},setAttribute(){},removeAttribute(){},click(){},focus(){},close(){},showModal(){}});
  return elements.get(selector);
}
globalThis.document={querySelector:element,querySelectorAll:()=>[],addEventListener:(name,fn)=>documentEvents.set(name,fn),createElement:()=>element('download-link')};
globalThis.location={hash:'#evaluation'};
globalThis.window={addEventListener:(name,fn)=>windowEvents.set(name,fn),scrollTo(){}};
await import('../dist/app.mjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const click=dataset=>documentEvents.get('click')({target:{closest:()=>({dataset})}});
const route=hash=>{location.hash=hash;windowEvents.get('hashchange')();};
const csv='true_label,predicted_label\ntomato_healthy,tomato_healthy\n';

test('CSV import refreshes the evaluation screen with calculated metrics',async t=>{
  t.mock.method(globalThis,'setTimeout',()=>0);
  route('#evaluation');
  const target={files:[{name:'independent.csv',size:csv.length,text:async()=>csv}],value:'chosen'};
  await element('#csv-input').handlers.get('change')({target});
  assert.match(element('#content').innerHTML,/independent\.csv/);
  assert.match(element('#content').innerHTML,/100\.0%/);
  assert.equal(element('#evaluation-error').textContent,'');
  assert.equal(target.value,'');
});
test('a delayed benchmark fetch does not replace the page after navigation',async t=>{
  t.mock.method(globalThis,'setTimeout',()=>0);
  let resolveFetch;
  t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{resolveFetch=resolve;}));
  route('#evaluation');click({action:'measured'});route('#project');
  const project=element('#content').innerHTML;
  resolveFetch({ok:true,text:async()=>csv});await flush();
  assert.equal(element('#content').innerHTML,project);
  route('#evaluation');assert.match(element('#content').innerHTML,/MEASURED TEST DATA/);
});
test('benchmark exports retain their measured V1 provenance',async t=>{
  t.mock.method(globalThis,'setTimeout',()=>0);
  let saved;
  t.mock.method(URL,'createObjectURL',blob=>{saved=blob;return 'blob:test';});
  click({action:'export-metrics'});
  const result=JSON.parse(await saved.text());
  assert.match(result.provenance,/LeafLens v1 held-out/);
  assert.doesNotMatch(result.provenance,/User-supplied/);
});
test('a delayed reference download cannot replace a newer image selection',async t=>{
  t.mock.method(globalThis,'setTimeout',()=>0);
  let resolveFetch;
  t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{resolveFetch=resolve;}));
  route('#scanner');click({sample:'healthy'});click({action:'real-sample'});
  click({sample:'early'});const selection=element('#dropzone').innerHTML;
  resolveFetch({ok:true,blob:async()=>new Blob(['image'])});await flush();
  assert.equal(element('#dropzone').innerHTML,selection);
  assert.match(selection,/Early blight/);
  assert.doesNotMatch(element('#input-action').innerHTML,/disabled/);
});
test('a failed reference decode cannot create a simulated success report',async t=>{
  t.mock.method(globalThis,'setTimeout',()=>0);
  t.mock.method(globalThis,'fetch',async()=>({ok:true,blob:async()=>new Blob(['invalid'],{type:'image/jpeg'})}));
  globalThis.Image=class {async decode(){throw Error('Cannot decode reference');}};
  route('#scanner');click({sample:'healthy'});
  const before=element('#history-count').textContent;click({action:'real-sample'});await flush();
  assert.equal(element('#history-count').textContent,before);
  assert.match(element('#upload-error').textContent,/Cannot decode/);
  assert.doesNotMatch(element('#input-action').innerHTML,/disabled/);
});
test('analysis is disabled while a replacement image is decoding',async t=>{
  t.mock.method(globalThis,'setTimeout',()=>0);
  let rejectDecode;
  globalThis.Image=class {decode(){return new Promise((resolve,reject)=>{rejectDecode=reject;});}};
  route('#scanner');click({sample:'healthy'});
  element('#file-input').handlers.get('change')({target:{files:[new File(['photo'],'test.jpg',{type:'image/jpeg'})],value:'chosen'}});
  assert.match(element('#input-action').innerHTML,/disabled/);
  rejectDecode(Error('Bad image'));await flush();
  assert.doesNotMatch(element('#input-action').innerHTML,/disabled/);
  assert.match(element('#dropzone').innerHTML,/Healthy leaf/);
});
