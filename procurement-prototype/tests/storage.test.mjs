import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openSession,STORAGE_KEY} from '../public/storage.mjs';
import {seed} from '../public/domain.mjs';
const date='2026-09-21';
function memory(raw=null){const values=new Map(raw===null?[]:[[STORAGE_KEY,raw]]);return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}
test('saved bookings survive reopening a session',()=>{
 const storage=memory(),a=openSession(storage,seed(date));
 const next=structuredClone(a.state);next.clock=615;a.save(next);
 assert.deepEqual(openSession(storage,seed('2026-09-22')).state,next);
});
test('a stale tab cannot overwrite a newer snapshot',()=>{
 const storage=memory(),a=openSession(storage,seed(date)),b=openSession(storage,seed(date));
 const next=structuredClone(a.state);next.clock=615;a.save(next);
 assert.throws(()=>b.save(b.state),/Another tab/);
 assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).clock,615);
});
test('damaged data is preserved for backup until an explicit reset',()=>{
 const raw='{damaged session',storage=memory(raw),session=openSession(storage,seed(date));
 assert.ok(session.warning);assert.equal(session.backup(),raw);
 assert.throws(()=>session.save(session.state),/not been overwritten/);
 assert.equal(storage.getItem(STORAGE_KEY),raw);
 session.save(seed(date),{reset:true});assert.equal(session.warning,'');
 assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)),seed(date));
});
test('write failures keep the last successful backup',()=>{
 const storage=memory(JSON.stringify(seed(date))),session=openSession(storage,seed(date)),original=session.backup();
 storage.setItem=()=>{throw Error('Storage full');};
 const next=structuredClone(session.state);next.clock=615;
 assert.throws(()=>session.save(next),/Storage full/);assert.equal(session.backup(),original);
});
