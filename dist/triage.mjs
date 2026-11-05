import {triage} from './reliability.mjs';
import {cases,referenceURL} from './data.mjs';

export const ACTION_NAMES={guidance:'Basic guidance',recapture:'Retake the image',expert:'Expert verification'};
// Reuse the existing curated tomato references rather than inventing treatment rules.
const referenceKeys={tomato_healthy:'healthy',tomato_early:'early',tomato_septoria:'septoria'};
export function decisionFor(prediction,crop,checks=[]) {
  let decision=triage({qualityPassed:checks.every(c=>c.ok),label:prediction?.label,confidence:prediction?.confidence,crop,
    set:prediction?.predictionSet,profile:prediction?.reliabilityProfile,modelHash:prediction?.modelSha256,classes:prediction?.classes});
  const key=referenceKeys[prediction?.label];
  if(decision.guidanceAllowed&&!key)decision={action:'expert',guidanceAllowed:false,reason:'There is no curated guidance entry for this condition. Seek expert verification.'};
  return {...decision,title:ACTION_NAMES[decision.action],guidance:decision.guidanceAllowed?{text:cases[key].next,source:referenceURL}:null};
}
export function triageText(decision) {
  if(!decision)return '';
  return `Next action: ${decision.title}\n${decision.reason}\n${decision.guidance?`Basic guidance: ${decision.guidance.text}\nSource: ${decision.guidance.source}\n`:''}`;
}
