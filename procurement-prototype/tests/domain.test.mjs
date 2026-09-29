import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed,addBooking,occupancy,transition,estimateQueue,validateSettings,validateState,advanceDay,DEFAULTS} from '../public/domain.mjs';
const date='2026-09-16';
const booking={name:'Test Farmer',village:'Test Village',date,slot:660,kg:400};
test('quantity and count capacity reject overbooking',()=>{
 const s=seed(date);addBooking(s,{...booking,kg:1200},'a');
 assert.equal(occupancy(s,date,660).kg,2000);
 assert.throws(()=>addBooking(s,{...booking,kg:1},'b'),/kg remain/);
 const t=seed(date);t.settings.maxBookings=1;
 assert.throws(()=>addBooking(t,booking,'b'),/booking limit/);
});
test('cancellation releases capacity and cancelled bookings cannot check in',()=>{
 const s=seed(date);transition(s,'demo-107','cancel');assert.deepEqual(occupancy(s,date,660),{count:0,kg:0});
 assert.throws(()=>transition(s,'demo-107','checkin'),/Only booked/);
});
test('booking validation rejects past, invalid and missing windows and dates',()=>{
 const s=seed(date);
 for(const data of [{slot:null},{slot:570},{slot:540},{date:'2026-09-15'},{date:'2026-02-31'},{kg:0},{kg:1.5}])assert.throws(()=>addBooking(s,{...booking,...data},'bad'));
});
test('processing is constrained by lanes and centre pauses',()=>{
 const s=seed(date);assert.throws(()=>transition(s,'demo-104','start'),/occupied/);
 transition(s,'demo-103','complete',{actualKg:375});
 s.pauseUntil=630;assert.throws(()=>transition(s,'demo-104','start'),/paused/);
 s.pauseUntil=0;transition(s,'demo-104','start');assert.equal(s.bookings.find(b=>b.id==='demo-104').status,'inspection');
});
test('normal delivery lifecycle stores actual weight and completion time',()=>{
 const s=seed(date);transition(s,'demo-103','complete',{actualKg:370});transition(s,'demo-104','start');
 assert.throws(()=>transition(s,'demo-104','complete',{actualKg:480}),/weighed/);
 transition(s,'demo-104','weigh');assert.throws(()=>transition(s,'demo-104','complete',{actualKg:0}),/valid actual/);
 s.clock+=20;transition(s,'demo-104','complete',{actualKg:480});const b=s.bookings.find(b=>b.id==='demo-104');assert.equal(b.actualKg,480);assert.equal(b.completedAt,620);
});
test('queue estimates reflect parallel lanes and pauses',()=>{
 const s=seed(date);let q=estimateQueue(s);assert.deepEqual(q.map(b=>b.token),['GV-104','GV-105']);assert.equal(q[0].wait,19);assert.equal(q[1].wait,23);
 s.pauseUntil=640;q=estimateQueue(s);assert.ok(q.every(b=>b.wait>=40));
});
test('holds require explanation and release a processing lane',()=>{
 const s=seed(date);assert.throws(()=>transition(s,'demo-102','hold'),/reason/);transition(s,'demo-102','hold',{note:'Recheck quality'});transition(s,'demo-104','start');assert.equal(s.bookings.find(b=>b.id==='demo-102').note,'Recheck quality');
});
test('check-in and no-show timing are enforced',()=>{
 const s=seed(date);assert.throws(()=>transition(s,'demo-107','checkin'),/30 minutes/);s.clock=630;transition(s,'demo-107','checkin');
 assert.throws(()=>transition(s,'demo-106','absent'),/window ends/);s.clock=660;transition(s,'demo-106','absent');
});
test('configuration is bounded and uses full-hour windows',()=>{
 assert.throws(()=>validateSettings({...DEFAULTS,open:555}));assert.throws(()=>validateSettings({...DEFAULTS,lanes:0}));assert.throws(()=>validateSettings({...DEFAULTS,close:540}));assert.doesNotThrow(()=>validateSettings(DEFAULTS));
});
test('a held delivery rejoins behind arrivals from the same minute',()=>{
 const s=seed(date);s.clock=630;
 transition(s,'demo-107','checkin');transition(s,'demo-108','resume');
 assert.deepEqual(estimateQueue(s).map(b=>b.id),['demo-104','demo-105','demo-107','demo-108']);
 transition(s,'demo-104','hold',{note:'Recheck'});transition(s,'demo-104','resume');
 assert.deepEqual(estimateQueue(s).map(b=>b.id),['demo-105','demo-107','demo-108','demo-104']);
});
test('next day preserves history and future bookings, and rejects unresolved work',()=>{
 const s=seed('2026-12-31'),before=structuredClone(s);
 assert.throws(()=>advanceDay(s),/outstanding/);assert.deepEqual(s,before);
 s.bookings.forEach(b=>{if(b.status!=='complete')b.status='cancelled';});
 addBooking(s,{...booking,date:'2027-01-01',slot:540},'tomorrow');
 s.pauseUntil=640;advanceDay(s);
 assert.equal(s.date,'2027-01-01');assert.equal(s.clock,540);assert.equal(s.pauseUntil,0);
 assert.equal(s.bookings.length,9);transition(s,'tomorrow','checkin');
});
test('saved sessions reject malformed bookings and duplicate identifiers',()=>{
 assert.doesNotThrow(()=>validateState(seed(date)));
 for(const mutate of [s=>s.clock=-1,s=>s.date='2026-02-31',s=>s.nextToken=101,s=>s.bookings[0].status='unknown',s=>s.bookings[0].kg='450',s=>s.bookings[0].actualKg=NaN,s=>s.bookings.push({...s.bookings[0]}),s=>s.bookings[0].id='bad" attribute']){
  const s=seed(date);mutate(s);assert.throws(()=>validateState(s));
 }
});
