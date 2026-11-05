import {test} from 'node:test';
import assert from 'node:assert/strict';
import {probabilities,conformalQuantile,conformalScores,predictionSet,calibrationMetrics,riskCoverage,detectionAUROC,triage} from '../dist/reliability.mjs';
import {decisionFor} from '../dist/triage.mjs';

test('finite-sample rank is ceil((n+1)(1-alpha)); insufficient samples give the full set',()=>{
  assert.equal(conformalQuantile([.1,.2,.3,.4],.4),.3);
  assert.equal(conformalQuantile([.1,.2],.1),Infinity);
  assert.deepEqual(predictionSet([.9,.1],['a','b'],{method:'LAC',qhat:null}),['a','b']);
});
test('LAC and deterministic inclusive-prefix APS have documented boundary and tie behaviour',()=>{
  conformalScores([.6,.3,.1],'APS').forEach((x,i)=>assert.ok(Math.abs(x-[.6,.9,1][i])<1e-12));
  assert.deepEqual(conformalScores([.5,.5],'APS'),[1,1]);
  assert.deepEqual(predictionSet([.6,.3,.1],['a','b','c'],{method:'APS',qhat:.5}),[]);
  assert.deepEqual(predictionSet([.6,.3,.1],['a','b','c'],{method:'LAC',qhat:.4}),['a']);
  assert.throws(()=>predictionSet([.8,.8],['a','b'],{method:'LAC',qhat:.4}));
});
test('calibration metrics match hand-computed log loss, Brier and ECE',()=>{
  const m=calibrationMetrics([{logits:[Math.log(.8),Math.log(.2)],true_label:'a'},{logits:[Math.log(.8),Math.log(.2)],true_label:'b'}],['a','b']);
  assert.ok(Math.abs(m.nll+Math.log(.16)/2)<1e-12);
  assert.ok(Math.abs(m.brier-.68)<1e-12);
  assert.ok(Math.abs(m.ece-.3)<1e-12);
  assert.equal(calibrationMetrics([],['a']).ece,null);
  assert.throws(()=>probabilities([NaN]));
});
test('risk-coverage does not split ties; AUROC uses half credit for ties',()=>{
  const r=riskCoverage([{score:.9,error:false},{score:.5,error:true},{score:.5,error:false}]);
  assert.equal(r.curve.length,2);assert.equal(r.curve[1].risk,1/3);
  assert.ok(Math.abs(r.aurc-2/9)<1e-12);
  assert.equal(detectionAUROC([0,1],[1,2]),.875);
  assert.equal(detectionAUROC([],[]),null);
});
test('quality, unknowns, absent evidence and model mismatch cannot produce guidance',()=>{
  const base={label:'tomato_early',confidence:.99,crop:'tomato',classes:['tomato_early'],set:['tomato_early'],modelHash:'abc'};
  const profile={evidence:'independent',guidanceEnabled:true,modelSha256:'abc',classes:base.classes,minConfidence:.8};
  assert.equal(triage({...base,qualityPassed:false}).action,'recapture');
  assert.equal(triage(base).action,'expert');
  assert.equal(triage({...base,profile:{...profile,evidence:'development_only'}}).action,'expert');
  assert.equal(triage({...base,profile,modelHash:'wrong'}).action,'expert');
  assert.equal(triage({...base,profile,unknown:true}).action,'expert');
  assert.equal(triage({...base,profile,set:['tomato_early','tomato_septoria']}).action,'recapture');
  assert.equal(triage({...base,profile}).action,'guidance');
});
test('current high-confidence models require expert verification and poor photos request recapture',()=>{
  assert.equal(decisionFor({label:'tomato_early',confidence:1},'tomato').action,'expert');
  assert.equal(decisionFor({},'tomato',[{ok:false}]).action,'recapture');
});

import {readFileSync} from 'node:fs';
import {reliabilityDashboard} from '../dist/research-dashboard.mjs';
test('published audit preserves missing-risk values and identifies reused development evidence',()=>{
  const report=JSON.parse(readFileSync(new URL('../dist/research/reliability-audit.json',import.meta.url)));
  assert.equal(report.evidence,'development_only');assert.equal(report.guidanceEnabled,false);
  assert.equal(report.historical.accepted,1);assert.equal(report.historical.knownCount,36);
  for(const experiment of report.experiments){
    assert.equal(experiment.profile.guidanceEnabled,false);
    for(const e of Object.values(experiment.evaluations)){
      assert.equal(e.before.count,e.knownCount);assert.equal(e.after.count,e.knownCount);
      assert.ok(e.singletonPolicy.knownAccepted<=e.confidencePolicy.knownAccepted);
      if(!e.singletonPolicy.knownAccepted)assert.equal(e.singletonPolicy.acceptedKnownRisk,null);
    }
  }
  const html=reliabilityDashboard(report);
  assert.match(html,/DEVELOPMENT ONLY/);assert.match(html,/No live guidance policy/);
  assert.match(html,/role="img"/);assert.match(html,/1\/36/);
});
