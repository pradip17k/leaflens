// Shared by the browser and offline research tools. No fitted values live in code.
export function probabilities(logits, temperature=1) {
  if(!Number.isFinite(temperature)||temperature<=0||!logits?.length||!Array.from(logits).every(Number.isFinite))throw Error('Invalid logits or temperature.');
  const scaled=Array.from(logits,x=>x/temperature), maximum=Math.max(...scaled);
  const exp=scaled.map(x=>Math.exp(x-maximum)), total=exp.reduce((a,b)=>a+b,0);
  return exp.map(x=>x/total);
}
function checkProbabilities(p) {
  if(!Array.isArray(p)||!p.length||p.some(x=>!Number.isFinite(x)||x<0||x>1)||Math.abs(p.reduce((a,b)=>a+b,0)-1)>1e-6)throw Error('Expected a probability vector.');
}
export function conformalScores(p, method='LAC') {
  checkProbabilities(p);
  if(method==='LAC')return p.map(x=>1-x);
  if(method!=='APS')throw Error('Supported conformal methods: LAC and APS.');
  // Deterministic inclusive-prefix APS score inversion, without randomization.
  // Empty sets are possible. Tied probabilities share their cumulative block score.
  return p.map(value=>Math.min(1,p.filter(x=>x>=value).reduce((a,b)=>a+b,0)));
}
export function conformalQuantile(scores, alpha=.1) {
  if(!scores.length||scores.some(x=>!Number.isFinite(x))||!Number.isFinite(alpha)||alpha<=0||alpha>=1)throw Error('Invalid conformal calibration.');
  const rank=Math.ceil((scores.length+1)*(1-alpha));
  return rank>scores.length?Infinity:[...scores].sort((a,b)=>a-b)[rank-1];
}
export function predictionSet(p, classes, profile) {
  if(classes.length!==p.length||new Set(classes).size!==classes.length)throw Error('Invalid class order.');
  // null serializes the infinite threshold: insufficient calibration => all labels.
  const q=profile.qhat===null?Infinity:profile.qhat;
  if(typeof q!=='number'||Number.isNaN(q)||q<0||q>1&&q!==Infinity)throw Error('Invalid conformal threshold.');
  return conformalScores(p,profile.method).flatMap((score,i)=>score<=q?[classes[i]]:[]);
}
export function uncertaintyScores(logits, temperature=1) {
  const p=probabilities(logits,temperature), maximum=Math.max(...logits);
  const energy=-temperature*(maximum/temperature+Math.log(logits.reduce((s,x)=>s+Math.exp((x-maximum)/temperature),0)));
  return {msp:Math.max(...p),maxLogit:maximum,energy}; // higher energy => more unfamiliar
}
export function calibrationMetrics(rows, classes, temperature=1, bins=15) {
  if(!Number.isInteger(bins)||bins<1||bins>100)throw Error('Invalid calibration bins.');
  if(!rows.length)return {count:0,accuracy:null,nll:null,brier:null,ece:null,bins:[]};
  const histogram=Array.from({length:bins},(_,i)=>({lower:i/bins,upper:(i+1)/bins,count:0,confidence:0,accuracy:0}));
  let correct=0,nll=0,brier=0;
  for(const row of rows) {
    const target=classes.indexOf(row.true_label);
    if(target<0||row.logits.length!==classes.length)throw Error('Calibration labels/logits do not match classes.');
    const p=probabilities(row.logits,temperature), confidence=Math.max(...p), hit=+(p.indexOf(confidence)===target);
    correct+=hit;
    const z=row.logits.map(x=>x/temperature), top=Math.max(...z);
    nll+=top+Math.log(z.reduce((s,x)=>s+Math.exp(x-top),0))-z[target];
    brier+=p.reduce((sum,x,i)=>sum+(x-+(i===target))**2,0);
    const bucket=histogram[Math.min(bins-1,Math.floor(confidence*bins))];
    bucket.count++;bucket.confidence+=confidence;bucket.accuracy+=hit;
  }
  let ece=0;
  for(const b of histogram)if(b.count){b.confidence/=b.count;b.accuracy/=b.count;ece+=b.count/rows.length*Math.abs(b.accuracy-b.confidence);}
  return {count:rows.length,accuracy:correct/rows.length,nll:nll/rows.length,brier:brier/rows.length,ece,bins:histogram};
}
export function riskCoverage(records) {
  // Each record has a scalar score (larger => accept first) and a boolean error.
  if(records.some(r=>!Number.isFinite(r.score)||typeof r.error!=='boolean'))throw Error('Invalid risk records.');
  const ordered=[...records].sort((a,b)=>b.score-a.score),curve=[];
  let errors=0,area=0,previous=0;
  // Accept tied scores together, so a curve never invents an unattainable threshold.
  for(let i=0;i<ordered.length;) {
    let j=i;while(j<ordered.length&&ordered[j].score===ordered[i].score){errors+=+ordered[j].error;j++;}
    const coverage=j/ordered.length,risk=errors/j;
    area+=(coverage-previous)*risk;previous=coverage;
    curve.push({coverage,risk,accepted:j,threshold:ordered[i].score});i=j;
  }
  return {count:ordered.length,aurc:ordered.length?area:null,curve,convention:'right-step area; tied scores accepted together'};
}
export function detectionAUROC(known, unknown) {
  // All scores point towards unknown; rank statistic with half credit for ties.
  if(!known.length||!unknown.length)return null;
  if([...known,...unknown].some(x=>!Number.isFinite(x)))throw Error('Invalid detection scores.');
  let wins=0;for(const u of unknown)for(const k of known)wins+=u>k?1:u===k?.5:0;
  return wins/(known.length*unknown.length);
}
export function triage({qualityPassed=true,label,confidence,crop,set=null,profile=null,modelHash,classes,unknown=false}) {
  const result=(action,reason)=>({action,reason,guidanceAllowed:action==='guidance'});
  if(!qualityPassed)return result('recapture','Improve the photo: use even light, focus and a close view of one leaf.');
  if(!Number.isFinite(confidence)||confidence<0||confidence>1||!label||!crop)return result('expert','The prediction is incomplete. Ask an agricultural specialist to review the image.');
  if(unknown||label==='unsupported'||!label.startsWith(crop+'_'))return result('expert','The image may be outside the selected crop or supported conditions. Seek expert verification.');
  if(!profile||profile.evidence!=='independent'||profile.guidanceEnabled!==true)return result('expert','This model has no independently evaluated guidance policy. Treat its label as a research estimate and seek verification.');
  if(!modelHash||profile.modelSha256!==modelHash||JSON.stringify(profile.classes)!==JSON.stringify(classes))return result('expert','The reliability profile does not match this model. Seek expert verification.');
  if(!Array.isArray(set)||set.length===0||set.includes('unsupported'))return result('expert','The prediction set does not support a known diagnosis. Seek expert verification.');
  if(set.length>1)return result('recapture','Several conditions remain plausible. Photograph another affected leaf; seek expert review if uncertainty persists.');
  if(!Number.isFinite(profile.minConfidence)||profile.minConfidence<0||profile.minConfidence>1)return result('expert','A guidance threshold has not been validated. Seek expert verification.');
  if(set[0]!==label||confidence<profile.minConfidence)return result('expert','The prediction does not meet the guidance policy. Seek expert verification.');
  return result('guidance','The prediction meets the evaluated screening policy. Read the basic guidance and monitor changes.');
}
