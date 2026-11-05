// Reanalyse stored DEVELOPMENT logits. Never promotes a model or changes weights.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {probabilities,conformalScores,conformalQuantile,predictionSet,calibrationMetrics,riskCoverage,uncertaintyScores,detectionAUROC} from '../dist/reliability.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const read=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const metadata=read('dist/model-v3/metadata.json');
const input='ml/runs/field-v3b/validation_logits.json';
const rows=read(input),classes=metadata.classes,alpha=.1;
if(new Set(rows.map(r=>r.path)).size!==rows.length)throw Error('Repeated record IDs.');
for(const r of rows) {
  if(!classes.includes(r.true_label)||r.logits.length!==classes.length||!['PlantVillage','PlantDoc'].includes(r.source))throw Error('Invalid saved record.');
  probabilities(r.logits);
}
// These source files expose image IDs, not reliable leaf IDs for every class.
// Separate records here do not prove independent leaves or undo model-selection reuse.
const partitions={temperature:[],conformal:[],audit:[]};
for(const source of ['PlantVillage','PlantDoc'])for(const label of classes) {
  const group=rows.filter(r=>r.source===source&&r.true_label===label)
    .sort((a,b)=>hash('leaflens-reliability-v1:'+a.path).localeCompare(hash('leaflens-reliability-v1:'+b.path)));
  const a=Math.floor(group.length*.35),b=a+Math.floor(group.length*.35);
  partitions.temperature.push(...group.slice(0,a));partitions.conformal.push(...group.slice(a,b));partitions.audit.push(...group.slice(b));
}
const known=records=>records.filter(r=>r.true_label!=='unsupported');
const count=records=>Object.fromEntries(classes.map(c=>[c,records.filter(r=>r.true_label===c).length]));
function fitTemperature(records) {
  if(!records.length)throw Error('Empty temperature partition.');
  // Fixed log-spaced NLL search. Includes the unscaled baseline; audit labels unused.
  const grid=[...new Set([1,...Array.from({length:81},(_,i)=>Math.exp(Math.log(.1)+i*Math.log(100)/80))])];
  return grid.reduce((best,t)=>calibrationMetrics(records,classes,t).nll<calibrationMetrics(records,classes,best).nll?t:best,1);
}
function summarize(records,temperature,profile) {
  const supported=known(records),unsupported=records.filter(r=>r.true_label==='unsupported');
  const prepared=records.map(row=>{
    const p=probabilities(row.logits,temperature),confidence=Math.max(...p),label=classes[p.indexOf(confidence)];
    const set=predictionSet(p,classes,profile);
    const cropMatch=row.true_label==='unsupported'||label.split('_')[0]===row.true_label.split('_')[0];
    return {row,p,label,set,confidence,baseline:label!=='unsupported'&&cropMatch&&confidence>=metadata.threshold,
      singleton:label!=='unsupported'&&cropMatch&&confidence>=metadata.threshold&&set.length===1&&set[0]===label};
  });
  const k=prepared.filter(x=>x.row.true_label!=='unsupported'),u=prepared.filter(x=>x.row.true_label==='unsupported');
  const accepted=key=>{
    const acceptedKnown=k.filter(x=>x[key]),acceptedUnknown=u.filter(x=>x[key]);
    return {knownAccepted:acceptedKnown.length,knownCoverage:k.length?acceptedKnown.length/k.length:null,
      acceptedKnownRisk:acceptedKnown.length?acceptedKnown.filter(x=>x.label!==x.row.true_label).length/acceptedKnown.length:null,
      unknownAccepted:acceptedUnknown.length,unknownCount:u.length,unknownFalseAcceptance:u.length?acceptedUnknown.length/u.length:null};
  };
  const rc=riskCoverage(k.map(x=>({score:x.confidence,error:x.label!==x.row.true_label})));
  const roc={};
  for(const score of ['msp','maxLogit','energy']) {
    const value=r=>{const s=uncertaintyScores(r.logits,temperature)[score];return score==='energy'?s:-s;};
    roc[score]=detectionAUROC(supported.map(value),unsupported.map(value));
  }
  return {knownCount:k.length,unknownCount:u.length,perClassCount:count(supported),
    before:calibrationMetrics(supported,classes),after:calibrationMetrics(supported,classes,temperature),
    conformalCoverage:k.length?k.filter(x=>x.set.includes(x.row.true_label)).length/k.length:null,
    averageSetSize:k.length?k.reduce((s,x)=>s+x.set.length,0)/k.length:null,
    emptySets:k.filter(x=>!x.set.length).length,
    perClassCoverage:Object.fromEntries([...new Set(supported.map(r=>r.true_label))].map(label=>{const rs=k.filter(x=>x.row.true_label===label);return [label,{count:rs.length,coverage:rs.filter(x=>x.set.includes(label)).length/rs.length}];})),
    confidencePolicy:accepted('baseline'),singletonPolicy:accepted('singleton'),riskCoverage:{...rc,curve:rc.curve.filter((_,i)=>i%Math.max(1,Math.floor(rc.curve.length/100))===0||i===rc.curve.length-1),displayDownsampled:true},unknownAUROC:roc,
    atCoverage:[.2,.5,.8,1].map(target=>{const point=rc.curve.find(p=>p.coverage>=target);return {requested:target,...point};})};
}
const experiments=[];
for(const calibrationDomain of ['PlantVillage','PlantDoc']) {
  const temp=known(partitions.temperature.filter(r=>r.source===calibrationDomain));
  const calibration=known(partitions.conformal.filter(r=>r.source===calibrationDomain));
  const temperature=fitTemperature(temp);
  for(const method of ['LAC','APS']) {
    const scores=calibration.map(r=>conformalScores(probabilities(r.logits,temperature),method)[classes.indexOf(r.true_label)]);
    const qhat=conformalQuantile(scores,alpha);
    const profile={method,qhat:Number.isFinite(qhat)?qhat:null,alpha,temperature,evidence:'development_only',guidanceEnabled:false,
      modelSha256:metadata.sha256,classes,calibrationDomain,calibrationCount:calibration.length};
    experiments.push({calibrationDomain,profile,temperatureCount:temp.length,
      evaluations:Object.fromEntries(['PlantVillage','PlantDoc'].map(source=>[source,summarize(partitions.audit.filter(r=>r.source===source),temperature,profile)]))});
  }
}
const historical=read('ml/runs/field-v3b/historical_external_predictions.json');
const historicalKnown=historical.filter(r=>r.true_label!=='unsupported');
const historicalUnknown=historical.filter(r=>r.true_label==='unsupported');
const historicalAccepted=historicalKnown.filter(r=>r.accepted);
const report={schemaVersion:1,modelVersion:metadata.version,modelSha256:metadata.sha256,classes,
  evidence:'development_only',guidanceEnabled:false,alpha,fixedConfidenceThreshold:metadata.threshold,
  inputSha256:hash(readFileSync(resolve(root,input))),
  partitions:Object.fromEntries(Object.entries(partitions).map(([name,records])=>[name,{count:records.length,idDigest:hash(records.map(r=>r.path).sort().join('\n'))}])),
  limitations:[
    'All input logits came from validation data already used to select V3. New partitions do not make this an independent evaluation.',
    'Partitions are by recorded image path; related leaves and source overlap remain possible. No claim of leaf-level independence.',
    'Nominal 90% conformal coverage requires exchangeability and a model fixed independently of calibration examples. Those conditions are not established here.',
    'Known-class risk curves rank all known images by maximum probability, including unsupported top-1 errors. Policies additionally reject crop mismatch and unsupported outputs.',
    'Unknown examples are previously seen unsupported-condition types, not a blind test of unseen disease classes or non-leaf objects.',
    'Known crop is supplied for known-policy evaluation; unknown false acceptance conservatively accepts any supported crop. No image-quality gate is applied.',
    'Threshold 0.8 is inherited, not retuned. Singleton policy is a retrospective candidate, not a validated guidance policy.',
    'No historical external image or label is used to fit temperature or conformal thresholds. The historical cohort is reused, not a fresh blind test.'
  ],experiments,
  historical:{knownCount:historicalKnown.length,accuracy:historicalKnown.filter(r=>r.true_label===r.predicted_label).length/historicalKnown.length,
    accepted:historicalAccepted.length,coverage:historicalAccepted.length/historicalKnown.length,
    acceptedRisk:historicalAccepted.length?historicalAccepted.filter(r=>r.true_label!==r.predicted_label).length/historicalAccepted.length:null,
    unknownCount:historicalUnknown.length,unknownAccepted:historicalUnknown.filter(r=>r.accepted).length,
    note:'Unchanged historical V3 benchmark. Full logits unavailable, so no new calibration/set analysis is claimed for this cohort.'}};
const output=resolve(root,'dist/research/reliability-audit.json');
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,evidence:report.evidence,partitions:report.partitions,historical:report.historical},null,2));
