import {LABELS,CLASS_NAMES,validateImageFile,inspectPixels,qualityChecks,parsePredictions,evaluatePredictions,EXAMPLE_CSV} from './core.mjs';
import {cases,referenceURL,icon} from './data.mjs';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=value=>`${(value*100).toFixed(1)}%`;
const size=value=>value<1024?`${value} B`:`${(value/1024).toFixed(1)} KB`;
const state={input:null,result:null,busy:false,generation:0,history:[],evaluation:null,filter:'all',query:'',error:''};
let toastTimer;
const pageTitles={scanner:'Leaf scanner',library:'Disease library',evaluation:'Model evaluation',history:'Session history',project:'Project guide'};
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));

function heading(eyebrow,title,description,aside=''){
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${aside}</div>`;
}
function tag(text,tone='green'){return `<span class="tag ${tone}">${text}</span>`;}
function notice(text){return `<div class="notice">${icon('info')}<div>${text}</div></div>`;}
function button(text,action,style='secondary',symbol='arrow'){return `<button class="btn ${style}" data-action="${action}">${symbol?icon(symbol):''}${text}</button>`;}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);}
function notifyError(message){state.error=message;const el=$('#upload-error');if(el)el.textContent=message;}
function setPage(key){if(location.hash===`#${key}`)route();else location.hash=key;}
function clearInput(){state.generation++;if(state.input?.objectURL)URL.revokeObjectURL(state.input.image);state.input=null;state.result=null;state.busy=false;state.error='';}

function scanner(){
  $('#content').innerHTML=heading('THE LEAF SCANNER','Good care starts with a closer look.','Check a leaf photograph or explore a labeled reference case.',tag('Tomato pilot'))+
  `<div class="mode-note"><span class="mode-label">DEMO MODE</span><p>Reference cases use simulated predictions. Your images receive real image-quality checks.</p><a href="#project">How it works ${icon('arrow')}</a></div>
  <div class="scanner-grid"><section class="panel input-panel"><div class="panel-heading"><h2><span class="step">01</span> Add a leaf image</h2><span class="micro">JPG / PNG / WEBP</span></div>
  <div class="input-body"><div class="crop-line"><span class="crop-icon">${icon('leaf')}</span><div><strong>Tomato</strong><small>Solanum lycopersicum</small></div>${tag('Selected crop','neutral')}</div>
  <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp" hidden>
  <div id="dropzone" class="dropzone"></div><div id="upload-error" class="error" role="alert"></div>
  <div id="input-action"></div><p class="privacy">${icon('shield')} Your image stays on this device.</p></div>
  <div class="sample-section"><div class="section-line"><h3>Try a reference leaf</h3><span>3 demo cases</span></div><div class="sample-grid">${Object.entries(cases).map(([key,c])=>`<button class="sample-card" data-sample="${key}" aria-pressed="${state.input?.key===key}"><img src="${c.image}" alt="${c.name} reference" width="256" height="256"><span>${c.name}</span><small>${c.category}</small></button>`).join('')}</div><p class="attribution">Photos: PlantVillage · <a href="#project">CC BY-SA 3.0 & credits</a></p></div></section>
  <section class="panel result-panel"><div class="panel-heading"><h2><span class="step">02</span> Your observation</h2><span id="result-status" class="micro">AWAITING INPUT</span></div><div id="result" class="result-body" aria-live="polite"></div></section></div>
  <section class="capture-guide"><div><span class="eyebrow">A BETTER PHOTO, A BETTER START</span><h2>Let the details do the talking.</h2></div><div>${icon('leaf')}<span><strong>One leaf</strong><small>Simple, uncluttered background</small></span></div><div>${icon('sun')}<span><strong>Natural light</strong><small>Even lighting, without glare</small></span></div><div>${icon('camera')}<span><strong>Keep it sharp</strong><small>Fill the frame; tap to focus</small></span></div></section>`;
  $('#file-input').addEventListener('change',e=>{if(e.target.files[0])loadFile(e.target.files[0]);e.target.value='';});
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
  $('#input-action').innerHTML=`<button class="btn primary full" data-action="analyze" ${!input||state.busy?'disabled':''}>${icon(state.busy?'scan':'arrow')}${state.busy?'Preparing observation…':input?.kind==='sample'?'Explore sample result':'Check image quality'}</button>`;
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
    state.result=null;renderInput();renderResult();toast('Image ready. Run a quality check to continue.');
  }catch(error){if(objectURL)URL.revokeObjectURL(objectURL);if(generation!==state.generation)return;notifyError(error.name==='EncodingError'?'This file cannot be decoded as an image. Choose another photograph.':error.message);renderInput();renderResult();}
}
function selectSample(key){
  if(!Object.hasOwn(cases,key))throw Error('Choose a supported reference case.');
  clearInput();const c=cases[key];state.input={kind:'sample',key,name:c.name,image:c.image};
  if(location.hash!=='#scanner')setPage('scanner');else{renderInput();renderResult();}
  return {case:key,mode:'simulated-demo'};
}
async function analyze(){
  if(!state.input||state.busy)return;
  state.busy=true;state.error='';const generation=state.generation;renderInput();renderResult();
  // Yield one frame for the explicit processing state, without suggesting model inference.
  await new Promise(resolve=>setTimeout(resolve,200));
  if(generation!==state.generation)return;
  const input=state.input;
  const report={id:crypto.randomUUID(),createdAt:new Date().toISOString(),name:input.name,kind:input.kind,crop:'Tomato',model:'Not connected'};
  if(input.kind==='sample')Object.assign(report,{key:input.key,confidence:cases[input.key].score,probabilities:cases[input.key].probabilities,disclaimer:'Simulated output for a labeled reference. No inference was performed.'});
  else Object.assign(report,{width:input.width,height:input.height,size:input.size,checks:qualityChecks(input.stats,input.width,input.height),disclaimer:'Image quality heuristics only. No leaf verification, disease diagnosis or pest detection was performed.'});
  state.result=report;state.busy=false;
  state.history.unshift(report);if(state.history.length>20)state.history.pop();
  $('#history-count').textContent=state.history.length;renderInput();renderResult();
  if(window.matchMedia('(max-width: 820px)').matches)$('#result')?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}
function renderResult(){
  const el=$('#result');if(!el)return;
  $('#result-status').textContent=state.busy?'PREPARING':state.result?'OBSERVATION READY':'AWAITING INPUT';
  if(state.busy){el.innerHTML=`<div class="empty-result"><div class="spinner"></div><h3>Preparing your observation</h3><p>Reading image quality or loading the selected demo.</p></div>`;return;}
  if(!state.result){el.innerHTML=`<div class="empty-result"><div class="scan-emblem">${icon('scan')}</div><span class="eyebrow">A SMALL SIGNAL CAN MATTER</span><h3>Your next insight<br>starts with a leaf.</h3><p>${state.input?'Your image is ready. Use the button on the left to continue.':'Choose a photograph to check its quality, or explore a reference to see a sample result.'}</p><div class="empty-flow"><span>Image</span><i></i><span>Observation</span><i></i><span>Next step</span></div></div><div class="result-bottom">${icon('shield')} Transparent results. No hidden uploads.</div>`;return;}
  const r=state.result;
  el.innerHTML=reportMarkup(r)+`<div class="report-actions">${button('Save report','download','secondary','download')}${button('Print','print','quiet','print')}</div>`;
}
function reportMarkup(r){
  if(r.kind==='sample'){
    const c=cases[r.key];
    return `<div class="result-title-row">${tag('SIMULATED RESULT','amber')}<span class="micro">TOMATO</span></div><h3 class="diagnosis">${c.name}</h3><p class="result-description">${c.description}</p><div class="confidence-box"><div><span>Example confidence</span><strong>${c.score.toFixed(1)}<small>%</small></strong></div><p>Preset demonstration value<br>Not measured model performance</p></div><div class="probabilities"><h4>Illustrative class distribution</h4>${LABELS.map((key,i)=>`<div class="probability"><div><span>${cases[key].name}</span><b>${c.probabilities[i].toFixed(1)}%</b></div><div class="bar"><i class="${key===r.key?'winner':''}" style="width:${c.probabilities[i]}%"></i></div></div>`).join('')}</div><div class="result-advice"><h4>${icon('leaf')} Visible reference signs</h4><p>${c.symptoms}</p></div><details class="next-step"><summary>What to do next</summary><p>${c.next}</p><a href="${referenceURL}" target="_blank" rel="noopener">Read the university extension guide ↗</a></details><p class="disclaimer">${icon('info')}${r.disclaimer}</p>`;
  }
  const flags=r.checks.filter(c=>!c.ok).length;
  return `<div class="result-title-row">${tag('IMAGE QUALITY CHECK',flags?'amber':'green')}<span class="micro">LOCAL ANALYSIS</span></div><h3 class="diagnosis">${flags?'A few details to improve.':'Your image is ready.'}</h3><p class="result-description">${flags?`${flags} capture ${flags===1?'suggestion':'suggestions'} to review before model inference.`:'The image passed the prototype’s basic capture checks.'}</p><div class="quality-list">${r.checks.map(c=>`<details class="quality-item"><summary><span class="quality-icon ${c.ok?'pass':'flag'}">${icon(c.ok?'check':'info')}</span><span>${c.label}<small>${c.value}</small></span><span class="quality-state">${c.ok?'Pass':'Review'}</span></summary><p>${c.detail}</p></details>`).join('')}</div><div class="model-note">${icon('info')}<div><strong>Disease model not connected</strong><p>These checks assess pixels, not plant health. They cannot verify that this image contains a tomato leaf.</p></div></div><p class="disclaimer">Exposure and detail thresholds are unvalidated heuristics. A pass does not guarantee a usable model input.</p>`;
}
function reportText(r){
  const intro=`LEAFLENS — OBSERVATION REPORT\n${new Date(r.createdAt).toLocaleString()}\n\nCrop: ${r.crop}\nInput: ${r.name}\nMode: ${r.kind==='sample'?'SIMULATED DEMO':'IMAGE QUALITY ONLY'}\n\n${r.disclaimer}\n\n`;
  return intro+(r.kind==='sample'?`Example class: ${cases[r.key].name}\nSimulated confidence: ${r.confidence}%\n\nVisible signs: ${cases[r.key].symptoms}\n\nNext step: ${cases[r.key].next}\n\nReference: ${referenceURL}`:r.checks.map(c=>`${c.label}: ${c.ok?'PASS':'REVIEW'} — ${c.value}\n${c.detail}`).join('\n\n'))+'\n\nResearch prototype. No trained disease or pest model is connected.\n';
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
  $('#content').innerHTML=heading('REFERENCE LIBRARY','Know the signs. Understand the limits.','Three tomato references to help you explain the pilot’s scope.',tag('3 reference classes'))+
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
  $('#content').innerHTML=heading('MODEL EVALUATION','Turn predictions into evidence.','Import labeled predictions to calculate your project’s evaluation metrics.',tag(evaluation?(evaluation.example?'EXAMPLE DATA':'IMPORTED DATA'):'NO DATA YET',evaluation?.example?'amber':'neutral'))+
  `<div class="panel evaluation-import"><div><h2>Bring your test-set predictions</h2><p>CSV · Two columns · Up to 10,000 rows · Computed on this device</p></div><div class="button-row">${button('CSV template','template','quiet','download')}${button('Load example','example','secondary','chart')}${button('Import CSV','import','primary','upload')}</div><input type="file" id="csv-input" accept=".csv,text/csv" hidden><p id="evaluation-error" class="error" role="alert"></p></div>`+
  (evaluation?evaluationResults(evaluation):`<div class="metrics">${['Accuracy','Macro precision','Macro recall','Macro F1'].map(label=>`<div class="panel metric"><span>${label}</span><strong>—</strong><small>Awaiting predictions</small></div>`).join('')}</div><div class="panel empty-page evaluation-empty"><div class="scan-emblem">${icon('chart')}</div><h2>Your model deserves a fair test.</h2><p>Load the clearly labeled example to explore the dashboard, or import predictions from your own held-out test set.</p><code>true_label,predicted_label<br>healthy,healthy<br>early,septoria</code></div>`)+
  `<div class="evaluation-notes"><section><h3>A fair comparison</h3><p>Evaluate a baseline CNN and MobileNetV2 on the same held-out images. Group photographs of the same leaf before splitting, and augment only training images.</p></section><section><h3>Read beyond accuracy</h3><p>Macro metrics give equal weight to all three classes. Zero-denominator scores are reported as 0. Review class support and independent field images.</p></section><section><h3>A goal, not a claim</h3><p>≥90% test accuracy is an initial target. No model is trained here. Imported results are calculated from your file; their provenance is not independently verified.</p></section></div>`;
  $('#csv-input').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>1024*1024)throw Error('Choose a CSV file under 1 MB.');const rows=parsePredictions(await file.text());state.evaluation={...evaluatePredictions(rows),example:false,name:file.name};if(currentPage()==='evaluation')evaluationPage();toast(`Evaluated ${rows.length} predictions.`);}catch(error){if($('#evaluation-error'))$('#evaluation-error').textContent=error.message;}finally{e.target.value='';}});
}
// Explicit alias avoids shadowing by the evaluation result variable above.
const evaluationPage=evaluation;
function evaluationResults(e){
  const max=Math.max(1,...e.matrix.flat());
  return `${notice(e.example?'<strong>Illustrative example dataset.</strong> These nine rows demonstrate the calculator. They are not output from a trained model.':`<strong>Calculated from your CSV:</strong> ${esc(e.name)}. Model identity, dataset independence and label quality have not been verified.`)}<div class="metrics">${[['Accuracy','accuracy'],['Macro precision','precision'],['Macro recall','recall'],['Macro F1','f1']].map(([name,key])=>`<div class="panel metric"><span>${name}</span><strong>${pct(e[key])}</strong><small>${e.count} labeled predictions</small></div>`).join('')}</div><div class="evaluation-grid"><section class="panel"><div class="panel-heading"><h2>Confusion matrix</h2><span class="micro">COUNTS</span></div><div class="matrix-wrap"><p>Predicted label →</p><table class="matrix"><caption class="sr-only">Rows are actual labels; columns are predicted labels.</caption><thead><tr><th scope="col">Actual ↓</th>${LABELS.map(k=>`<th scope="col">${CLASS_NAMES[k]}</th>`).join('')}</tr></thead><tbody>${e.matrix.map((row,i)=>`<tr><th scope="row">${CLASS_NAMES[LABELS[i]]}</th>${row.map((value,j)=>`<td class="${i===j?'correct':'incorrect'}" style="--strength:${.08+.6*value/max}" title="Actual ${CLASS_NAMES[LABELS[i]]}; predicted ${CLASS_NAMES[LABELS[j]]}: ${value}">${value}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="matrix-hint">The diagonal shows correct classifications.</p></div></section><section class="panel"><div class="panel-heading"><h2>Per-class performance</h2></div><div class="table-wrap"><table><thead><tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1</th><th>Count</th></tr></thead><tbody>${e.perClass.map(c=>`<tr><th scope="row">${CLASS_NAMES[c.label]}</th><td>${pct(c.precision)}</td><td>${pct(c.recall)}</td><td>${pct(c.f1)}</td><td>${c.support}</td></tr>`).join('')}</tbody></table></div><div class="panel-padding"><p class="muted">${e.perClass.some(c=>c.support===0)?'At least one class is missing from the true labels. Macro scores still include all three classes.':'All three classes have true-label examples in this file.'}</p><div class="button-row">${button('Export metrics','export-metrics','secondary','download')}${button('Clear data','clear-evaluation','quiet','close')}</div></div></section></div>`;
}

function history(){
  $('#content').innerHTML=heading('SESSION HISTORY','Keep your observations together.','Your latest 20 reports in this tab. Reloading clears this session.',tag(`${state.history.length} reports`,'neutral'))+
  (state.history.length?`<div class="panel"><div class="panel-heading"><h2>Recent observations</h2>${button('Clear session','clear-history','quiet','close')}</div><div class="table-wrap"><table><thead><tr><th>Input</th><th>Report type</th><th>Time</th><th>Result</th><th>Report</th></tr></thead><tbody>${state.history.map(r=>`<tr><th scope="row"><span class="history-name">${esc(r.name)}</span></th><td>${tag(r.kind==='sample'?'Demo':'Quality check',r.kind==='sample'?'amber':'green')}</td><td>${new Date(r.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td><td>${r.kind==='sample'?'Simulated result':`${r.checks.filter(c=>c.ok).length}/4 checks passed`}</td><td><button class="btn quiet" data-report="${r.id}" aria-label="View report for ${esc(r.name)}">View ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div></div>`:`<div class="panel empty-page"><div class="scan-emblem">${icon('history')}</div><h2>A fresh page for your observations.</h2><p>Check an image or explore a sample to create your first report.</p><a class="btn primary" href="#scanner">Go to scanner ${icon('arrow')}</a></div>`)+notice('Only report metadata is held in memory. Images are not saved in history, and nothing is written to browser storage. Download reports you want to keep.');
}
function project(){
  $('#content').innerHTML=heading('THE PROJECT GUIDE','A focused pilot. A measurable next step.','Crop Disease and Pest Detection using Leaf Images · Mini-project',tag('SDG 2 · Zero Hunger'))+
  `<div class="project-hero"><div><span class="eyebrow">AGRICULTURE & ENVIRONMENTAL SUSTAINABILITY</span><h2>From visible symptoms<br>to informed observation.</h2><p>LeafLens demonstrates the journey from a leaf photograph to a clear report. The tomato pilot establishes the interface, image checks and evaluation tools needed before a validated classifier is introduced.</p></div><div class="project-number"><strong>03</strong><span>REFERENCE CLASSES</span><p>Healthy · Early blight<br>Septoria leaf spot</p></div></div>
  <div class="project-grid"><section class="panel panel-padding"><h2>What works today</h2><ul class="checklist"><li>Local image input, preview and enlargement</li><li>Pixel-based image-quality checks</li><li>Three photographed and labeled demo cases</li><li>Session reports, downloads and printing</li><li>CSV evaluation with per-class metrics</li></ul></section><section class="panel panel-padding"><h2>What still needs evidence</h2><ul class="checklist pending"><li>A trained, validated disease classifier</li><li>Field-image and out-of-scope evaluation</li><li>Calibrated confidence and rejection thresholds</li><li>Specialist review of agricultural guidance</li><li>A separate pest dataset and model</li></ul></section></div>
  <section class="panel panel-padding roadmap"><div class="section-line"><h2>The technical pathway</h2><span class="micro">IMPLEMENTATION ROADMAP</span></div><div class="workflow">${[['01','Prepare data','License, label and deduplicate images. Split by original leaf or source.'],['02','Compare models','Train a baseline CNN and fine-tune MobileNetV2 on the same split.'],['03','Evaluate honestly','Report class metrics and field performance. Set uncertainty rules on validation data.'],['04','Connect inference','Match class order and preprocessing. Replace demo output with verified predictions.']].map(([n,t,p])=>`<div><span>${n}</span><h3>${t}</h3><p>${p}</p></div>`).join('')}</div></section>
  <div class="project-grid"><section class="panel panel-padding"><h2>For your presentation</h2><p>Demonstrate a reference case, show a real photo’s quality checks, then import prediction rows into the evaluation workspace.</p><p>Describe this as a working interface and evaluation prototype. Do not claim that simulated confidence values are model accuracy.</p><p class="muted">Problem reference supplied by the project brief: SIH26131 – Software. Official status and affiliation have not been verified.</p></section><section class="panel panel-padding sources"><h2>Sources & image credits</h2><p>Reference photographs: PlantVillage, Mohanty, Hughes & Salathé. Original files are unchanged; display sizes vary.</p><a href="https://github.com/spMohanty/PlantVillage-Dataset" target="_blank" rel="noopener">PlantVillage source dataset ↗</a><a href="https://huggingface.co/datasets/mohanty/PlantVillage" target="_blank" rel="noopener">Dataset card and license declaration ↗</a><a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">Photo license: CC BY-SA 3.0 ↗</a><a href="assets/credits.json" target="_blank" rel="noopener">Exact image sources & attribution ↗</a><a href="${referenceURL}" target="_blank" rel="noopener">University of Minnesota symptom reference ↗</a></section></div>`;
}

const actions={
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
  try{Promise.resolve(document.modelContext.registerTool({name:'stage_leaf_demo',description:'Stage a labeled tomato reference with a simulated result flow. Does not run model inference.',inputSchema:{type:'object',properties:{case:{type:'string',enum:LABELS}},required:['case'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||Object.keys(input).length!==1||!LABELS.includes(input.case))throw Error('Provide one supported case.');const result=selectSample(input.case);route();return result;}},{signal:lifecycle.signal})).catch(()=>{});}catch{/* Optional browser capability; normal UI stays available. */}
}
