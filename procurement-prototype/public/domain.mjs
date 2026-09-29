export const DEFAULTS={name:'Green Valley Procurement Centre',crop:'Paddy',open:540,close:1020,maxBookings:4,maxKg:2000,baseMinutes:10,kgPerMinute:50,lanes:2};
export const STATUS={booked:'Booked',arrived:'Checked in',inspection:'Quality check',weighing:'Weighing',complete:'Completed',hold:'On hold',rejected:'Not accepted',cancelled:'Cancelled',absent:'No-show'};
export const ACTIVE=['inspection','weighing'];
export const CAPACITY=['booked','arrived','inspection','weighing','complete','hold','rejected'];
const queueOrder=(a,b)=>a.arrivedAt-b.arrivedAt||(a.queueOrder??Number(a.token.slice(3)))-(b.queueOrder??Number(b.token.slice(3)));
function joinQueue(state,b){b.status='arrived';b.arrivedAt=state.clock;b.queueOrder=1+state.bookings.reduce((max,x)=>Math.max(max,x.queueOrder??Number(x.token.slice(3))),0);}
export function advanceDay(state){
  if(state.bookings.some(b=>b.date<=state.date&&['booked','arrived','inspection','weighing','hold'].includes(b.status)))throw Error('Resolve today’s outstanding deliveries before starting the next day. Complete, cancel, or mark eligible no-shows first.');
  const date=new Date(state.date+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+1);
  state.date=date.toISOString().slice(0,10);state.clock=state.settings.open;state.pauseUntil=0;
}
export function validateState(state){
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  if(!state||state.version!==1||!validDate(state.date)||!integer(state.clock,0,1439)||!integer(state.pauseUntil,0,1439)||!integer(state.nextToken,1,Number.MAX_SAFE_INTEGER)||!Array.isArray(state.bookings))throw Error('Saved session is invalid.');
  validateSettings(state.settings);
  const ids=new Set(),tokens=new Set();let largest=0;
  for(const b of state.bookings){
    if(!b||typeof b.id!=='string'||!/^[-\w]+$/.test(b.id)||ids.has(b.id)||typeof b.token!=='string'||!/^GV-\d+$/.test(b.token)||tokens.has(b.token)||!validDate(b.date)||!Object.hasOwn(STATUS,b.status)||!integer(b.kg,1,100000)||!integer(b.slot,0,1380)||b.slot%60)throw Error('Saved booking is invalid.');
    for(const [key,max] of [['name',60],['crop',40],['village',60]])if(typeof b[key]!=='string'||b[key].length>max||(key!=='village'&&!b[key].trim()))throw Error('Saved booking details are invalid.');
    for(const key of ['arrivedAt','startedAt','expectedEnd','completedAt','queueOrder'])if(b[key]!==undefined&&!integer(b[key],0,Number.MAX_SAFE_INTEGER))throw Error('Saved booking timing is invalid.');
    if(['arrived',...ACTIVE].includes(b.status)&&!integer(b.arrivedAt,0,1439))throw Error('Saved arrival time is invalid.');
    if(b.status==='complete'&&(!Number.isFinite(b.actualKg)||b.actualKg<=0||b.actualKg>100000))throw Error('Saved accepted weight is invalid.');
    if(b.note!==undefined&&(typeof b.note!=='string'||b.note.length>200))throw Error('Saved reason is invalid.');
    ids.add(b.id);tokens.add(b.token);largest=Math.max(largest,Number(b.token.slice(3)));
  }
  if(state.nextToken<=largest)throw Error('Saved token counter is invalid.');
  return state;
}
export const minuteLabel=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
export function slots(settings){return Array.from({length:(settings.close-settings.open)/60},(_,i)=>settings.open+i*60);}
export function duration(booking,settings){return Math.ceil(settings.baseMinutes+booking.kg/settings.kgPerMinute);}
export function occupancy(state,date,slot){const entries=state.bookings.filter(b=>b.date===date&&b.slot===slot&&CAPACITY.includes(b.status));return {count:entries.length,kg:entries.reduce((n,b)=>n+b.kg,0)};}
export function validateSettings(s){
  if(!s.name?.trim()||s.name.length>80)throw Error('Use a centre name of 1–80 characters.');
  if(!s.crop?.trim()||s.crop.length>40)throw Error('Use a crop name of 1–40 characters.');
  for(const [key,min,max] of [['open',0,1320],['close',60,1440],['maxBookings',1,30],['maxKg',1,100000],['baseMinutes',1,120],['kgPerMinute',1,1000],['lanes',1,10]])if(!Number.isInteger(s[key])||s[key]<min||s[key]>max)throw Error(`Invalid value for ${key}.`);
  if(s.close<=s.open||s.open%60||s.close%60)throw Error('Use whole-hour opening and closing times, with closing after opening.');
  return s;
}
export function validateBooking(state,data){
  if(!data.name?.trim()||data.name.trim().length>60)throw Error('Enter a farmer name of 1–60 characters.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(data.date)||Number.isNaN(Date.parse(data.date+'T00:00:00'))||new Date(data.date+'T00:00:00Z').toISOString().slice(0,10)!==data.date)throw Error('Choose a valid date.');
  if(data.date<state.date)throw Error('Choose today or a future date in the demo calendar.');
  if(!Number.isInteger(data.kg)||data.kg<1)throw Error('Enter a whole-number quantity of at least 1 kg.');
  if(!slots(state.settings).includes(data.slot))throw Error('Select an available time window.');
  if(data.date===state.date&&data.slot<state.clock)throw Error('That arrival window has already started. Choose a later one.');
  const used=occupancy(state,data.date,data.slot);
  if(used.count>=state.settings.maxBookings)throw Error('That window has reached its booking limit. Choose another.');
  if(used.kg+data.kg>state.settings.maxKg)throw Error(`Only ${Math.max(0,state.settings.maxKg-used.kg)} kg remain in that window.`);
  return true;
}
export function addBooking(state,data,id){
  validateBooking(state,data);
  const booking={id,token:`GV-${String(state.nextToken++).padStart(3,'0')}`,name:data.name.trim(),village:(data.village||'').trim().slice(0,60),date:data.date,slot:data.slot,kg:data.kg,crop:state.settings.crop,status:'booked'};
  state.bookings.push(booking);return booking;
}
export function transition(state,id,action,extra={}){
  const b=state.bookings.find(b=>b.id===id);if(!b)throw Error('Booking not found.');
  if(action==='cancel') {if(!['booked','arrived','hold'].includes(b.status))throw Error('This booking cannot be cancelled at its current stage.');b.status='cancelled';return;}
  if(b.date!==state.date)throw Error('This action is only available for the current demo day.');
  if(action==='checkin'){if(b.status!=='booked')throw Error('Only booked deliveries can check in.');if(state.clock<state.settings.open||state.clock>=state.settings.close)throw Error('Check-in is closed outside centre hours.');if(state.clock<b.slot-30)throw Error('Check-in opens 30 minutes before the booked window.');joinQueue(state,b);return;}
  if(action==='start'){if(b.status!=='arrived')throw Error('Check in the delivery first.');if(state.pauseUntil>state.clock)throw Error('Processing is paused. Resume the centre first.');if(state.clock<state.settings.open||state.clock>=state.settings.close)throw Error('New processing can only start during centre hours.');const busy=state.bookings.filter(x=>x.date===state.date&&ACTIVE.includes(x.status)).length;if(busy>=state.settings.lanes)throw Error('All processing lanes are occupied. Complete or hold a delivery first.');const next=state.bookings.filter(x=>x.date===state.date&&x.status==='arrived').sort(queueOrder)[0];if(next?.id!==b.id)throw Error('Start the first checked-in delivery before later arrivals.');b.status='inspection';b.startedAt=state.clock;b.expectedEnd=state.clock+duration(b,state.settings);return;}
  if(action==='weigh'){if(b.status!=='inspection')throw Error('Complete the quality check first.');b.status='weighing';return;}
  if(action==='complete'){if(b.status!=='weighing')throw Error('Only weighed deliveries can complete.');if(!Number.isFinite(extra.actualKg)||extra.actualKg<=0||extra.actualKg>100000)throw Error('Enter a valid actual weight between 0 and 100,000 kg.');b.status='complete';b.actualKg=extra.actualKg;b.completedAt=state.clock;return;}
  if(action==='hold'||action==='reject'){if(!['arrived',...ACTIVE].includes(b.status))throw Error('Check in a delivery before recording this outcome.');if(!extra.note?.trim())throw Error('Add a reason for this outcome.');b.status=action==='hold'?'hold':'rejected';b.note=extra.note.trim().slice(0,200);return;}
  if(action==='resume'){if(b.status!=='hold')throw Error('Only held deliveries can rejoin the queue.');joinQueue(state,b);delete b.startedAt;delete b.expectedEnd;return;}
  if(action==='absent'){if(b.status!=='booked'||state.clock<b.slot+60)throw Error('Mark a no-show only after its booked window ends.');b.status='absent';return;}
  throw Error('Unsupported action.');
}
export function estimateQueue(state){
  const ready=Math.max(state.clock,state.pauseUntil||0,state.settings.open);
  const active=state.bookings.filter(b=>b.date===state.date&&ACTIVE.includes(b.status));
  const availability=Array.from({length:Math.max(state.settings.lanes,active.length)},(_,i)=>active[i]?Math.max(ready+5,active[i].expectedEnd||ready+duration(active[i],state.settings)):ready);
  const waiting=state.bookings.filter(b=>b.date===state.date&&b.status==='arrived').sort(queueOrder);
  return waiting.map(b=>{availability.sort((a,b)=>a-b);const start=availability[0];availability[0]+=duration(b,state.settings);return {...b,wait:Math.max(0,start-state.clock),start,end:availability[0],outsideHours:start>=state.settings.close};});
}
export function seed(date){
  const state={version:1,date,clock:600,pauseUntil:0,nextToken:109,settings:{...DEFAULTS},bookings:[]};
  const rows=[['101','Ravi Kumar','Hosur',540,450,'complete'],['102','Lakshmi Devi','Kallur',540,620,'inspection'],['103','Manjunath S.','Hosur',540,380,'weighing'],['104','Asha Rani','Belur',600,500,'arrived'],['105','Suresh Gowda','Kallur',600,700,'arrived'],['106','Nandini R.','Belur',600,350,'booked'],['107','Prakash M.','Hosur',660,800,'booked'],['108','Geetha S.','Kallur',540,400,'hold']];
  state.bookings=rows.map(([n,name,village,slot,kg,status],i)=>({id:'demo-'+n,token:'GV-'+n,name,village,slot,kg,date,crop:'Paddy',status,...(status!=='booked'?{arrivedAt:slot+i}:{}),...(ACTIVE.includes(status)?{startedAt:590+i*3,expectedEnd:615+i*4}:{}),...(status==='complete'?{startedAt:545,completedAt:570,actualKg:445}:{}),...(status==='hold'?{note:'Farmer requested a later quality check.'}:{})}));
  state.bookings.find(b=>b.id==='demo-104').arrivedAt=592;
  state.bookings.find(b=>b.id==='demo-105').arrivedAt=597;
  return state;
}
