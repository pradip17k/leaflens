import {MODEL_LABELS as LABELS,CLASS_NAMES,validateImageFile,inspectPixels,qualityChecks,parsePredictions as parseCSV,evaluatePredictions as calculateMetrics} from './core.mjs';
import {cases,referenceURL,icon} from './data.mjs';
import {crops} from './crops.mjs';
import {predict} from './inference.mjs';
const parsePredictions=text=>parseCSV(text,LABELS);
const evaluatePredictions=rows=>calculateMetrics(rows,LABELS);
const EXAMPLE_CSV='true_label,predicted_label\n'+LABELS.map((label,i)=>`${label},${LABELS[i===1?0:i]}`).join('\n');

const $=selector=>document.querySelector(selector);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=value=>`${(value*100).toFixed(1)}%`;
const size=value=>value<1024?`${value} B`:`${(value/1024).toFixed(1)} KB`;
const state={crop:'tomato',input:null,result:null,busy:false,generation:0,history:[],evaluation:null,filter:'all',query:'',error:''};
let toastTimer;
const pageTitles={scanner:'Leaf scanner',library:'Disease library',evaluation:'Model evaluation',history:'Session history',project:'Project guide'};
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));

function heading(eyebrow,title,description,aside=''){
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${aside}</div>`;
}
function tag(text,tone='green'){return `<span class="tag ${tone}">${text}</span>`;}
function notice(text){return `<div class="notice">${icon('info')}<div>${text}</div></div>`;}
function cropScope(){return `<section class="crop-scope" aria-label="Crop dataset scope">${Object.values(crops).map(c=>`<article class="panel panel-padding"><h2>${c.name}</h2><p class="muted">${c.scientific}</p><ul>${c.classes.map(([,name])=>`<li>${name}</li>`).join('')}</ul><p>${c.datasetNote}</p></article>`).join('')}</section>`;}
function button(text,action,style='secondary',symbol='arrow'){return `<button class="btn ${style}" data-action="${action}">${symbol?icon(symbol):''}${text}</button>`;}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);}
function notifyError(message){state.error=message;const el=$('#upload-error');if(el)el.textContent=message;}
function setPage(key){if(location.hash===`#${key}`)route();else location.hash=key;}
function clearInput(){state.generation++;if(state.input?.objectURL)URL.revokeObjectURL(state.input.image);state.input=null;state.result=null;state.busy=false;state.error='';}

function scanner(){
  $('#content').innerHTML=heading('THE LEAF SCANNER','Good care starts with a closer look.','Choose your crop and check a leaf photograph.',tag('3 crops · 9 classes'))+
  `<div class="mode-note"><span class="mode-label">RESEARCH MODEL</span><p>Uploaded photos run through a trained model on your device. Reference demos remain simulated. External benchmark: 25% accuracy on 36 images. Research use only.</p><a href="#project">How it works ${icon('arrow')}</a></div>
  <div class="scanner-grid"><section class="panel input-panel"><div class="panel-heading"><h2><span class="step">01</span> Add a leaf image</h2><span class="micro">JPG / PNG / WEBP</span></div>
  <div class="input-body"><div class="crop-line"><span class="crop-icon">${icon('leaf')}</span><div><label for="crop-select">Select crop</label><select id="crop-select">${Object.entries(crops).map(([key,crop])=>`<option value="${key}" ${state.crop===key?'selected':''}>${crop.name}</option>`).join('')}</select><small>${crops[state.crop].scientific}</small></div>${tag('Local prediction','neutral')}</div><p class="muted">Supported classes: ${crops[state.crop].classes.map(c=>c[1]).join(' · ')}. Research predictions require confirmation.</p>
  <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp" hidden>
  <div id="dropzone" class="dropzone"></div><div id="upload-error" class="error" role="alert"></div>
  <div id="input-action"></div><p class="privacy">${icon('shield')} Your image stays on this device.</p></div>
  <div class="sample-section">${state.crop==='tomato'?`<div class="section-line"><h3>Try a tomato reference leaf</h3><span>3 demo cases</span></div><div class="sample-grid">${Object.entries(cases).map(([key,c])=>`<button class="sample-card" data-sample="${key}" aria-pressed="${state.input?.key===key}"><img src="${c.image}" alt="${c.name} reference" width="256" height="256"><span>${c.name}</span><small>${c.category}</small></button>`).join('')}</div><p class="attribution">Photos: PlantVillage · <a href="#project">CC BY-SA 3.0 & credits</a></p>`:`<h3>${crops[state.crop].name} dataset scope</h3><p>${crops[state.crop].datasetNote}</p><p>Upload a clear leaf photo for a local model prediction. Results are research estimates and may be wrong.</p>`}</div></section>
  <section class="panel result-panel"><div class="panel-heading"><h2><span class="step">02</span> Your observation</h2><span id="result-status" class="micro">AWAITING INPUT</span></div><div id="result" class="result-body" aria-live="polite"></div></section></div>
  <section class="capture-guide"><div><span class="eyebrow">A BETTER PHOTO, A BETTER START</span><h2>Let the details do the talking.</h2></div><div>${icon('leaf')}<span><strong>One leaf</strong><small>Simple, uncluttered background</small></span></div><div>${icon('sun')}<span><strong>Natural light</strong><small>Even lighting, without glare</small></span></div><div>${icon('camera')}<span><strong>Keep it sharp</strong><small>Fill the frame; tap to focus</small></span></div></section>`;
  $('#file-input').addEventListener('change',e=>{if(e.target.files[0])loadFile(e.target.files[0]);e.target.value='';});
  $('#crop-select').addEventListener('change',e=>{clearInput();state.crop=e.target.value;scanner();});
  const dz=$('#dropzone');
  dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});
  dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));
  dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('dragover');if(e.dataTransfer.files.length!==1){notifyError('Choose one leaf image at a time.');return;}loadFile(e.dataTransfer.files[0]);});
  renderInput();renderResult();
}
function renderInput(){
  if(!$('#dropzone'))return;
  const input=state.input;
  $('#dropzone').classList.toggle('has-image',!!input);
  $('#dropzone').innerHTML=input?`<div class="preview"><img src="${esc(input.image)}" alt="${input.kind==='sample'?esc(input.name)+' reference photograph':'Your selected image'}"><span class="preview-badge">${input.kind==='sample'?'REFERENCE PHOTO':'YOUR IMAGE'}</span><button class="zoom-button" data-action="zoom" aria-label="Enlarge leaf image">${icon('zoom')}</button></div><div class="file-line"><div><strong>${esc(input.name)}</strong><small>${input.kind==='sample'?'PlantVillage · Labeled reference':`${input.width} × ${input.height} px · ${size(input.size)}`}</small></div><button class="icon-button" data-action="remove" aria-label="Remove selected image">${icon('close')}</button></div>`:
  `<div class="upload-target"><div class="upload-icon">${icon('upload')}</div><h3>Drop your leaf image here</h3><p>One clear photo. Up to 10 MB.</p>${button('Choose image','browse','secondary','upload')}<span class="drop-hint">or drag & drop from your device</span></div>`;
  $('#input-action').innerHTML=`<button class="btn primary full" data-action="analyze" ${!input||state.busy?'disabled':''}>${icon(state.busy?'scan':'arrow')}${state.busy?'Preparing observation…':input?.kind==='sample'?'Explore sample result':'Analyze leaf'}</button>`;
  if(input?.kind==='sample')$('#input-action').innerHTML+=button('Run the real model on this photo','real-sample','secondary','scan');
  notifyError(state.error);
  document.querySelectorAll('[data-sample]').forEach(el=>el.setAttribute('aria-pressed',String(input?.key===el.dataset.sample)));
}
async function loadFile(file){
  // Keep the previous valid selection when a new file fails validation.
  const generation=++state.generation;
  state.busy=false;state.error='';
  let objectURL;
  try{
    validateImageFile(file);objectURL=URL.createObjectURL(file);
    const img=new Image();img.src=objectURL;await img.decode();
    if(generation!==state.generation){URL.revokeObjectURL(objectURL);return;}
    const width=img.naturalWidth,height=img.naturalHeight;
    if(Math.min(width,height)<128)throw Error('Choose an image at least 128 × 128 pixels.');
    if(width*height>40000000)throw Error('Resize this image below 40 megapixels.');
    const canvas=document.createElement('canvas');const scale=Math.min(1,256/Math.max(width,height));
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const stats=inspectPixels(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
    if(state.input?.objectURL)URL.revokeObjectURL(state.input.image);
    state.input={kind:'upload',name:file.name,image:objectURL,objectURL:true,width,height,size:file.size,stats};
    state.result=null;renderInput();renderResult();toast('Image ready. Analyze the leaf to continue.');
  }catch(error){if(objectURL)URL.revokeObjectURL(objectURL);if(generation!==state.generation)return;notifyError(error.name==='EncodingError'?'This file cannot be decoded as an image. Choose another photograph.':error.message);renderInput();renderResult();}
}
function selectSample(key){
  if(!Object.hasOwn(cases,key))throw Error('Choose a supported reference case.');
  clearInput();state.crop='tomato';const c=cases[key];state.input={kind:'sample',key,name:c.name,image:c.image};
  if(location.hash!=='#scanner')setPage('scanner');else{renderInput();renderResult();}
  return {case:key,mode:'simulated-demo'};
}
async function analyze(){
  if(!state.input||state.busy)return;
  state.busy=true;state.error='';const generation=state.generation,input=state.input,crop=state.crop;renderInput();renderResult();
  try{
    const report={id:crypto.randomUUID(),createdAt:new Date().toISOString(),name:input.name,kind:input.kind,crop:crops[crop].name,model:'Not used'};
    if(input.kind==='sample')Object.assign(report,{key:input.key,confidence:cases[input.key].score,probabilities:cases[input.key].probabilities,disclaimer:'Simulated output for a labeled reference. No inference was performed.'});
    else{
      const checks=qualityChecks(input.stats,input.width,input.height);
      Object.assign(report,{width:input.width,height:input.height,size:input.size,checks,disclaimer:'Image quality heuristics only. Prediction withheld because a capture check failed.'});
      if(checks.every(c=>c.ok)){
        const prediction=await predict(input.image,crop);
        Object.assign(report,prediction,{kind:'model',disclaimer:'Research prediction from a limited nine-class model. Non-leaf images and unsupported diseases can receive confident but incorrect results. Seek agricultural confirmation before acting.'});
      }
    }
    if(generation!==state.generation)return;
    state.result=report;state.history.unshift(report);if(state.history.length>20)state.history.pop();
    $('#history-count').textContent=state.history.length;
  }catch(error){
    if(generation===state.generation){state.result=null;state.error='Prediction could not finish: '+error.message;}
  }finally{
    if(generation===state.generation){state.busy=false;renderInput();renderResult();}
  }
}
function renderResult(){
  const el=$('#result');if(!el)return;
  $('#result-status').textContent=state.busy?'PREPARING':state.result?'OBSERVATION READY':'AWAITING INPUT';
  if(state.busy){el.innerHTML=`<div class="empty-result"><div class="spinner"></div><h3>Preparing your observation</h3><p>Loading the model and analyzing locally. The first run may take a moment.</p></div>`;return;}
  if(!state.result){el.innerHTML=`<div class="empty-result"><div class="scan-emblem">${icon('scan')}</div><span class="eyebrow">A SMALL SIGNAL CAN MATTER</span><h3>Your next insight<br>starts with a leaf.</h3><p>${state.input?'Your image is ready. Use the button on the left to continue.':'Choose a photograph to check its quality, or explore a reference to see a sample result.'}</p><div class="empty-flow"><span>Image</span><i></i><span>Observation</span><i></i><span>Next step</span></div></div><div class="result-bottom">${icon('shield')} Transparent results. No hidden uploads.</div>`;return;}
  const r=state.result;
  el.innerHTML=reportMarkup(r)+`<div class="report-actions">${button('Save report','download','secondary','download')}${button('Print','print','quiet','print')}</div>`;
}
function reportMarkup(r){
  if(r.kind==='model'){
    return `<div class="result-title-row">${tag(r.accepted?'MODEL PREDICTION':'UNCERTAIN',r.accepted?'green':'amber')}<span class="micro">${esc(r.crop)}</span></div><h3 class="diagnosis">${r.accepted?CLASS_NAMES[r.label]:'Please retake or confirm.'}</h3><p>${esc(r.reason)}</p><div class="confidence-box"><div><span>Model confidence</span><strong>${(r.confidence*100).toFixed(1)}<small>%</small></strong></div><p>Validation-calibrated score<br>Not diagnostic certainty</p></div><p class="muted">${esc(r.model)} · ${esc(r.version)} · Runs on your device</p><details><summary>All class scores</summary><div class="probabilities">${r.classes.map((key,i)=>`<div class="probability"><div><span>${CLASS_NAMES[key]}</span><b>${(r.probabilities[i]*100).toFixed(1)}%</b></div></div>`).join('')}</div></details><p class="disclaimer">${esc(r.disclaimer)}</p><p>Photograph more leaves and consult an agricultural specialist. A healthy prediction does not rule out other conditions.</p>`;
  }
  if(r.kind==='sample'){
    const c=cases[r.key];
    return `<div class="result-title-row">${tag('SIMULATED RESULT','amber')}<span class="micro">TOMATO</span></div><h3 class="diagnosis">${c.name}</h3><p class="result-description">${c.description}</p><div class="confidence-box"><div><span>Example confidence</span><strong>${c.score.toFixed(1)}<small>%</small></strong></div><p>Preset demonstration value<br>Not measured model performance</p></div><div class="probabilities"><h4>Illustrative class distribution</h4>${Object.keys(cases).map((key,i)=>`<div class="probability"><div><span>${cases[key].name}</span><b>${c.probabilities[i].toFixed(1)}%</b></div><div class="bar"><i class="${key===r.key?'winner':''}" style="width:${c.probabilities[i]}%"></i></div></div>`).join('')}</div><div class="result-advice"><h4>${icon('leaf')} Visible reference signs</h4><p>${c.symptoms}</p></div><details class="next-step"><summary>What to do next</summary><p>${c.next}</p><a href="${referenceURL}" target="_blank" rel="noopener">Read the university extension guide ↗</a></details><p class="disclaimer">${icon('info')}${r.disclaimer}</p>`;
  }
  const flags=r.checks.filter(c=>!c.ok).length;
  return `<div class="result-title-row">${tag('IMAGE QUALITY CHECK',flags?'amber':'green')}<span class="micro">${esc(r.crop)} · LOCAL ANALYSIS</span></div><h3 class="diagnosis">${flags?'A few details to improve.':'Your image is ready.'}</h3><p class="result-description">${flags?`${flags} capture ${flags===1?'suggestion':'suggestions'} to review before model inference.`:'The image passed the prototype’s basic capture checks.'}</p><div class="quality-list">${r.checks.map(c=>`<details class="quality-item"><summary><span class="quality-icon ${c.ok?'pass':'flag'}">${icon(c.ok?'check':'info')}</span><span>${c.label}<small>${c.value}</small></span><span class="quality-state">${c.ok?'Pass':'Review'}</span></summary><p>${c.detail}</p></details>`).join('')}</div><div class="model-note">${icon('info')}<div><strong>Prediction withheld for image quality</strong><p>Retake the photo to improve the flagged capture checks. These heuristics cannot recognize leaves or guarantee a valid input.</p></div></div><p class="disclaimer">Exposure and detail thresholds are unvalidated heuristics. A pass does not guarantee a usable model input.</p>`;
}
function reportText(r){
  if(r.kind==='model')return `LEAFLENS RESEARCH PREDICTION\nCrop: ${r.crop}\nInput: ${r.name}\nModel: ${r.model} / ${r.version}\nResult: ${r.accepted?CLASS_NAMES[r.label]:'Uncertain'}\nConfidence: ${(r.confidence*100).toFixed(1)}%\n\n${r.reason}\n${r.disclaimer}\n${new Date(r.createdAt).toISOString()}\n`;
  const intro=`LEAFLENS — OBSERVATION REPORT\n${new Date(r.createdAt).toLocaleString()}\n\nCrop: ${r.crop}\nInput: ${r.name}\nMode: ${r.kind==='sample'?'SIMULATED DEMO':'IMAGE QUALITY ONLY'}\n\n${r.disclaimer}\n\n`;
  return intro+(r.kind==='sample'?`Example class: ${cases[r.key].name}\nSimulated confidence: ${r.confidence}%\n\nVisible signs: ${cases[r.key].symptoms}\n\nNext step: ${cases[r.key].next}\n\nReference: ${referenceURL}`:r.checks.map(c=>`${c.label}: ${c.ok?'PASS':'REVIEW'} — ${c.value}\n${c.detail}`).join('\n\n'))+'\n\nResearch prototype. No disease inference was performed for this demo or quality-only report.\n';
}
function saveFile(filename,text,type='text/plain'){
  const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function saveReport(report=state.result){if(!report)return;saveFile(`leaflens-${report.kind}-${report.id.slice(0,8)}.txt`,reportText(report));toast('Report saved with its demo or quality-only label.');}
function openDialog(title,body,wide=false){
  const dialog=$('#dialog');dialog.classList.toggle('wide',wide);dialog.innerHTML=`<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div>${body}`;dialog.showModal();
}
function printReport(report=state.result){if(!report)return;openDialog('Observation report',`<div class="print-report"><div class="report-brand">LeafLens / Crop Health Lab</div><p class="micro">${esc(new Date(report.createdAt).toLocaleString())} · ${esc(report.name)}</p>${reportMarkup(report)}</div><div class="dialog-actions">${button('Print / Save PDF','print-now','primary','print')}</div>`);}

function library(){
  $('#content').innerHTML=heading('REFERENCE LIBRARY','Know the signs. Understand the limits.','Nine classes across three crops, followed by three tomato demo photographs.',tag('3 crops · 9 classes'))+cropScope()+
  `<div class="library-toolbar"><label class="search-field">${icon('search')}<input id="library-search" type="search" placeholder="Search symptoms or conditions…" aria-label="Search disease library" value="${esc(state.query)}"></label><div class="filter-group" aria-label="Filter references">${[['all','All references'],['healthy','Healthy'],['disease','Diseases']].map(([key,label])=>`<button class="filter-btn ${state.filter===key?'selected':''}" data-filter="${key}" aria-pressed="${state.filter===key}">${label}</button>`).join('')}</div></div><div id="library-results" class="library-grid"></div><p id="library-count" class="muted" aria-live="polite"></p>
  <div class="scope-banner"><span class="scope-icon">${icon('info')}</span><div><h3>Similar symptoms, different causes.</h3><p>Disease, pest damage and environmental stress can look alike. Pest detection remains a future extension requiring its own data and validation.</p></div></div>`;
  $('#library-search').addEventListener('input',e=>{state.query=e.target.value;renderLibrary();});renderLibrary();
}
function renderLibrary(){
  const filtered=Object.entries(cases).filter(([key,c])=>(state.filter==='all'||(state.filter==='healthy'?key==='healthy':key!=='healthy'))&&`${c.name} ${c.symptoms}`.toLowerCase().includes(state.query.toLowerCase()));
  $('#library-results').innerHTML=filtered.length?filtered.map(([key,c])=>`<article class="panel disease-card"><div class="disease-image"><img src="${c.image}" alt="${c.name} tomato reference photograph" width="256" height="256">${tag(c.category,c.color)}</div><div class="disease-body"><h2>${c.name}</h2><p>${c.symptoms}</p><ul>${c.features.map(f=>`<li>${f}</li>`).join('')}</ul><button class="btn secondary full" data-sample="${key}">Explore sample ${icon('arrow')}</button></div></article>`).join(''):`<div class="panel empty-page"><h2>No matching references</h2><p>Try “spots”, “green” or reset the filters.</p>${button('Reset filters','reset-filters')}</div>`;
  $('#library-count').textContent=`${filtered.length} of 3 references · Photographs: PlantVillage, CC BY-SA 3.0. Labels are supplied by the dataset.`;
}

function evaluation(){
  const evaluation=state.evaluation;
  $('#content').innerHTML=heading('MODEL EVALUATION','Turn predictions into evidence.','Evaluate all nine crop-specific classes. Load the measured test results or import your own prediction CSV.',tag(evaluation?(evaluation.example?'EXAMPLE DATA':evaluation.measured?'MEASURED TEST DATA':'IMPORTED DATA'):'NO DATA YET',evaluation?.example?'amber':'neutral'))+
  `<div class="panel evaluation-import"><div><h2>Bring your test-set predictions</h2><p>CSV · Two columns · Up to 10,000 rows · Computed on this device</p></div><div class="button-row">${button('Measured results','measured','secondary','chart')}${button('CSV template','template','quiet','download')}${button('Load example','example','secondary','chart')}${button('Import CSV','import','primary','upload')}</div><input type="file" id="csv-input" accept=".csv,text/csv" hidden><p id="evaluation-error" class="error" role="alert"></p></div>`+
  (evaluation?evaluationResults(evaluation):`<div class="metrics">${['Accuracy','Macro precision','Macro recall','Macro F1'].map(label=>`<div class="panel metric"><span>${label}</span><strong>—</strong><small>Awaiting predictions</small></div>`).join('')}</div><div class="panel empty-page evaluation-empty"><div class="scan-emblem">${icon('chart')}</div><h2>Your model deserves a fair test.</h2><p>Load the clearly labeled example to explore the dashboard, or import predictions from your own held-out test set.</p><code>true_label,predicted_label<br>tomato_healthy,tomato_healthy<br>potato_early,potato_late</code></div>`)+
  `<div class="evaluation-notes"><section><h3>A fair comparison</h3><p>Evaluate a baseline CNN and MobileNetV2 on the same held-out images. Group photographs of the same leaf before splitting, and augment only training images.</p></section><section><h3>Read beyond accuracy</h3><p>Macro metrics give equal weight to all nine classes. Zero-denominator scores are reported as 0. Review class support and independent field images.</p></section><section><h3>A goal, not a claim</h3><p>Measured results describe the held-out PlantVillage split, not field accuracy. Imported results are calculated from your file; their provenance is not independently verified.</p></section></div>`;
  $('#csv-input').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>1024*1024)throw Error('Choose a CSV file under 1 MB.');const rows=parsePredictions(await file.text());state.evaluation={...evaluatePredictions(rows),example:false,name:file.name};if(currentPage()==='evaluation')evaluationPage();toast(`Evaluated ${rows.length} predictions.`);}catch(error){if($('#evaluation-error'))$('#evaluation-error').textContent=error.message;}finally{e.target.value='';}});
}
// Explicit alias avoids shadowing by the evaluation result variable above.
const evaluationPage=evaluation;
function evaluationResults(e){
  const max=Math.max(1,...e.matrix.flat());
  return `${notice(e.example?'<strong>Illustrative example dataset.</strong> These nine rows demonstrate the calculator. They are not output from a trained model.':`<strong>${e.measured?'Measured held-out results:':'Calculated from your CSV:'}</strong> ${esc(e.name)}. ${e.measured?'Held-out PlantVillage evaluation. Maize has provisional image-level splits. External PlantDoc accuracy was only 25% on 36 supported-disease images; 22 of 41 unsupported-disease images passed the acceptance rule. Research use only.':'Model identity, dataset independence and label quality have not been verified.'}`)}<div class="metrics">${[['Accuracy','accuracy'],['Macro precision','precision'],['Macro recall','recall'],['Macro F1','f1']].map(([name,key])=>`<div class="panel metric"><span>${name}</span><strong>${pct(e[key])}</strong><small>${e.count} labeled predictions</small></div>`).join('')}</div><div class="evaluation-grid"><section class="panel"><div class="panel-heading"><h2>Confusion matrix</h2><span class="micro">COUNTS</span></div><div class="matrix-wrap"><p>Predicted label →</p><table class="matrix"><caption class="sr-only">Rows are actual labels; columns are predicted labels.</caption><thead><tr><th scope="col">Actual ↓</th>${LABELS.map(k=>`<th scope="col">${CLASS_NAMES[k]}</th>`).join('')}</tr></thead><tbody>${e.matrix.map((row,i)=>`<tr><th scope="row">${CLASS_NAMES[LABELS[i]]}</th>${row.map((value,j)=>`<td class="${i===j?'correct':'incorrect'}" style="--strength:${.08+.6*value/max}" title="Actual ${CLASS_NAMES[LABELS[i]]}; predicted ${CLASS_NAMES[LABELS[j]]}: ${value}">${value}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="matrix-hint">The diagonal shows correct classifications.</p></div></section><section class="panel"><div class="panel-heading"><h2>Per-class performance</h2></div><div class="table-wrap"><table><thead><tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1</th><th>Count</th></tr></thead><tbody>${e.perClass.map(c=>`<tr><th scope="row">${CLASS_NAMES[c.label]}</th><td>${pct(c.precision)}</td><td>${pct(c.recall)}</td><td>${pct(c.f1)}</td><td>${c.support}</td></tr>`).join('')}</tbody></table></div><div class="panel-padding"><p class="muted">${e.perClass.some(c=>c.support===0)?'At least one class is missing from the true labels. Macro scores still include all nine classes.':'All nine classes have true-label examples in this file.'}</p><div class="button-row">${button('Export metrics','export-metrics','secondary','download')}${button('Clear data','clear-evaluation','quiet','close')}</div></div></section></div>`;
}

function history(){
  $('#content').innerHTML=heading('SESSION HISTORY','Keep your observations together.','Your latest 20 reports in this tab. Reloading clears this session.',tag(`${state.history.length} reports`,'neutral'))+
  (state.history.length?`<div class="panel"><div class="panel-heading"><h2>Recent observations</h2>${button('Clear session','clear-history','quiet','close')}</div><div class="table-wrap"><table><thead><tr><th>Input</th><th>Report type</th><th>Time</th><th>Result</th><th>Report</th></tr></thead><tbody>${state.history.map(r=>`<tr><th scope="row"><span class="history-name">${esc(r.name)}</span></th><td>${tag(r.kind==='sample'?'Demo':r.kind==='model'?'Model prediction':'Quality check',r.kind==='sample'?'amber':'green')}</td><td>${new Date(r.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td><td>${r.kind==='sample'?'Simulated result':r.kind==='model'?(r.accepted?CLASS_NAMES[r.label]:'Uncertain'):`${r.checks.filter(c=>c.ok).length}/4 checks passed`}</td><td><button class="btn quiet" data-report="${r.id}" aria-label="View report for ${esc(r.name)}">View ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div></div>`:`<div class="panel empty-page"><div class="scan-emblem">${icon('history')}</div><h2>A fresh page for your observations.</h2><p>Check an image or explore a sample to create your first report.</p><a class="btn primary" href="#scanner">Go to scanner ${icon('arrow')}</a></div>`)+notice('Only report metadata is held in memory. Images are not saved in history, and nothing is written to browser storage. Download reports you want to keep.');
}
function project(){
  $('#content').innerHTML=heading('THE PROJECT GUIDE','Three crops. Measured evidence.','Crop Leaf Disease Detection · Student research',tag('SDG 2 · Zero Hunger'))+cropScope()+
  `<section class="panel panel-padding"><h2>From photo to research prediction</h2><p>Choose tomato, potato or maize, upload a clear leaf photo, and run the trained model locally in your browser. Low model confidence or a crop mismatch produces an uncertain result. Photo checks can withhold a prediction when capture quality is poor.</p><p>The system cannot reliably reject every non-leaf image or unsupported disease. It is not a field-validated diagnostic service.</p></section>
  <div class="project-grid"><section class="panel panel-padding"><h2>Training and evaluation</h2><p>A compact CNN and a pretrained MobileNetV2 are compared using the same validation split. The selected model is calibrated on validation data and evaluated on the reserved test set.</p><p>8,489 images · 5,919 training · 1,285 validation · 1,285 testing. Tomato and potato use recorded leaf groups. Maize splits are provisional image-level splits.</p><a class="btn secondary" href="#evaluation">Explore measured results</a></section><section class="panel panel-padding"><h2>What the results do not establish</h2><p>A separate PlantDoc check scored 25% on 36 supported-disease images; 22 of 41 unsupported conditions passed the confidence/crop rule. Independent phone and farm trials remain outstanding. Backgrounds may influence predictions. Healthy potato has only 24 test images. Confidence does not establish that a photo contains a supported leaf.</p><p>Pest identification is outside this model's scope. Do not use results as pesticide prescriptions.</p></section></div>
  <section class="panel panel-padding sources"><h2>Reproducibility and credits</h2><p>Images stay on your device. Model and runtime assets are downloaded from this website. The three tomato reference demos still use explicitly simulated scores.</p><a href="model/test_metrics.json">Test metrics and limitations</a><a href="model/comparison.json">Validation comparison and selection</a><a href="model/external_metrics.json">External benchmark and unsupported-disease results</a><a href="model/metadata.json">Model version and preprocessing</a><a href="model/model-card.md">Model card and project report</a><a href="https://github.com/spMohanty/PlantVillage-Dataset" target="_blank" rel="noopener">PlantVillage dataset</a><a href="assets/credits.json">Reference image credits</a><a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">Image license: CC BY-SA 3.0</a><a href="vendor/ONNX-RUNTIME-LICENSE.txt">ONNX Runtime license</a><p>Problem reference supplied by the project brief: SIH26131. Official affiliation has not been verified.</p></section>`;
}

const actions={
  'real-sample':async()=>{if(state.input?.kind!=='sample'||state.busy)return;const source=state.input.image;try{const response=await fetch(source);if(!response.ok)throw Error('Reference image unavailable.');await loadFile(new File([await response.blob()],'reference-photo.jpg',{type:'image/jpeg'}));await analyze();}catch(error){notifyError(error.message);}},
  measured:async()=>{try{const response=await fetch('model/test_predictions.csv');if(!response.ok)throw Error('Measured results are unavailable.');const rows=parsePredictions(await response.text());state.evaluation={...evaluatePredictions(rows),example:false,measured:true,name:'LeafLens v1 · held-out PlantVillage test set'};evaluation();}catch(error){toast(error.message);}},
  browse:()=>$('#file-input')?.click(),
  analyze,
  remove:()=>{clearInput();renderInput();renderResult();},
  zoom:()=>{if(state.input)openDialog('Leaf image',`<img class="zoom-image" src="${esc(state.input.image)}" alt="${esc(state.input.name)}"><p class="muted">${state.input.kind==='sample'?'Labeled reference photograph. The demo result is simulated.':'Your selected image. No disease diagnosis has been performed.'}</p>`,true);},
  download:()=>saveReport(),print:()=>printReport(),'print-now':()=>{document.querySelectorAll('#dialog details').forEach(detail=>detail.open=true);window.print();},'close-dialog':()=>$('#dialog').close(),
  'reset-filters':()=>{state.filter='all';state.query='';library();},
  template:()=>saveFile('leaflens-predictions-template.csv','true_label,predicted_label\n','text/csv'),
  example:()=>{state.evaluation={...evaluatePredictions(parsePredictions(EXAMPLE_CSV)),example:true,name:'Illustrative example (9 rows)'};evaluation();},
  import:()=>$('#csv-input').click(),
  'export-metrics':()=>{if(state.evaluation)saveFile('leaflens-evaluation.json',JSON.stringify({...state.evaluation,provenance:state.evaluation.example?'Illustrative example, not a model result':'User-supplied predictions; provenance not verified',macroLabels:LABELS,zeroDivision:0},null,2),'application/json');},
  'clear-evaluation':()=>{state.evaluation=null;evaluation();},
  'clear-history':()=>{state.history=[];$('#history-count').textContent='0';history();toast('Session reports cleared.');}
};
document.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.dataset.action){actions[target.dataset.action]?.();return;}
  if(target.dataset.sample){selectSample(target.dataset.sample);return;}
  if(target.dataset.filter){state.filter=target.dataset.filter;library();return;}
  if(target.dataset.report){const report=state.history.find(r=>r.id===target.dataset.report);if(report)printReport(report);}
});
$('#dialog').addEventListener('click',event=>{if(event.target===$('#dialog')){const rect=$('#dialog').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$('#dialog').close();}});
const pages={scanner,library,evaluation,history,project};
function currentPage(){return Object.hasOwn(pages,location.hash.slice(1))?location.hash.slice(1):'scanner';}
function route(){
  if(location.hash==='#content'){document.querySelector('main').focus();return;}
  const key=currentPage();$('#breadcrumb').textContent=pageTitles[key];document.title=`${pageTitles[key]} · LeafLens`;
  document.querySelectorAll('[data-page]').forEach(a=>{a.classList.toggle('active',a.dataset.page===key);if(a.dataset.page===key)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  pages[key]();window.scrollTo(0,0);
}
window.addEventListener('hashchange',route);route();
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  try{Promise.resolve(document.modelContext.registerTool({name:'stage_leaf_demo',description:'Stage a labeled tomato reference with a simulated result flow. Does not run model inference.',inputSchema:{type:'object',properties:{case:{type:'string',enum:Object.keys(cases)}},required:['case'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||Object.keys(input).length!==1||!Object.hasOwn(cases,input.case))throw Error('Provide one supported case.');const result=selectSample(input.case);route();return result;}},{signal:lifecycle.signal})).catch(()=>{});}catch{/* Optional browser capability; normal UI stays available. */}
}
