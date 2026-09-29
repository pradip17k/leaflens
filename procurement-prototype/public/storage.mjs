import {validateState} from './domain.mjs';

export const STORAGE_KEY='procureflow-prototype-v1';

// Compare the saved snapshot before writing so a stale tab cannot silently
// replace newer work. This is a local demo safeguard, not database locking.
export function openSession(storage,fallback){
  let raw=null,blocked=false,warning='',state=fallback;
  try{
    raw=storage.getItem(STORAGE_KEY);
    if(raw!==null)state=validateState(JSON.parse(raw));
  }catch{
    blocked=true;
    warning='Saved data could not be opened. It has not been overwritten. Download a backup before resetting the sample day.';
  }
  return {
    state,warning,
    backup:()=>raw??JSON.stringify(state,null,2),
    save(next,{reset=false}={}){
      validateState(next);
      if(blocked&&!reset)throw Error(warning);
      const current=storage.getItem(STORAGE_KEY);
      if(current!==raw)throw Error('Another tab changed this session. Reload this page before making more changes.');
      const value=JSON.stringify(next);
      storage.setItem(STORAGE_KEY,value);
      raw=value;state=next;blocked=false;this.warning='';
    }
  };
}
