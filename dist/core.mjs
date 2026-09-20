export const LABELS = ['healthy', 'early', 'septoria'];
export const CLASS_NAMES = {healthy:'Healthy leaf',early:'Early blight',septoria:'Septoria leaf spot'};
export const MODEL_LABELS=['tomato_healthy','tomato_early','tomato_septoria','potato_healthy','potato_early','potato_late','maize_healthy','maize_rust','maize_northern_blight'];
Object.assign(CLASS_NAMES,{tomato_healthy:'Tomato · Healthy',tomato_early:'Tomato · Early blight',tomato_septoria:'Tomato · Septoria',potato_healthy:'Potato · Healthy',potato_early:'Potato · Early blight',potato_late:'Potato · Late blight',maize_healthy:'Maize · Healthy',maize_rust:'Maize · Common rust',maize_northern_blight:'Maize · Northern blight'});
Object.assign(CLASS_NAMES,{tomato_mite_damage:'Tomato · Spider-mite damage (experimental)',unsupported:'Unsupported condition'});
export function validateImageFile(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('Choose a JPG, PNG or WebP image.');
  if (!file.size) throw Error('This file is empty. Choose another image.');
  if (file.size > 10 * 1024 * 1024) throw Error('This image exceeds 10 MB. Resize it and try again.');
}
export function inspectPixels(data, width, height) {
  // Exposure and texture heuristics, not a learned quality or disease model.
  let total=0,clipped=0,transparent=0,visible=0;
  const gray=new Float64Array(width*height);
  for(let i=0;i<gray.length;i++) {
    const j=i*4;
    if(data[j+3]<128){transparent++;continue;}
    const luma=.2126*data[j]+.7152*data[j+1]+.0722*data[j+2];
    gray[i]=luma;total+=luma;visible++;
    if(luma<15||luma>245)clipped++;
  }
  let gradient=0,pairs=0;
  for(let y=1;y<height;y++)for(let x=1;x<width;x++) {
    const i=y*width+x;
    if(data[i*4+3]<128||data[(i-1)*4+3]<128||data[(i-width)*4+3]<128)continue;
    gradient+=Math.abs(gray[i]-gray[i-1])+Math.abs(gray[i]-gray[i-width]);pairs+=2;
  }
  return {brightness:visible?total/visible:0,clipped:visible?clipped/visible:1,texture:pairs?gradient/pairs:0,transparent:transparent/gray.length};
}
export function qualityChecks(stats,width,height) {
  return [
    {label:'Image resolution',value:`${width} × ${height} px`,ok:Math.min(width,height)>=128,detail:Math.min(width,height)>=128?'Enough pixels for the 128 × 128 model input.':'Try an image at least 128 pixels on each side.'},
    {label:'Exposure',value:stats.brightness<45?'Low light':stats.brightness>220?'Very bright':'Balanced',ok:stats.brightness>=45&&stats.brightness<=220,detail:stats.brightness<45?'Try brighter, even lighting.':stats.brightness>220?'Avoid strong glare and direct light.':'Average brightness is within the prototype’s heuristic range.'},
    {label:'Visible detail',value:stats.texture<3?'Limited texture':'Detail present',ok:stats.texture>=3,detail:stats.texture<3?'Move closer and refocus. A plain background can also cause this flag.':'Neighboring pixels show contrast. This does not guarantee sharp focus.'},
    {label:'Transparency',value:stats.transparent>.25?'Large clear area':'Mostly opaque',ok:stats.transparent<=.25,detail:stats.transparent>.25?'Prefer an original photograph without transparent areas.':'The image has a mostly visible surface.'}
  ];
}
export function parsePredictions(text, labels=LABELS) {
  const rows=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(row=>row.trim());
  if(rows.length<2)throw Error('Add at least one prediction below the true_label,predicted_label header.');
  if(rows.length>10001)throw Error('Import at most 10,000 predictions per file.');
  const cells=row=>row.split(',').map(v=>v.trim().replace(/^"([^"\r\n]*)"$/,'$1'));
  if(cells(rows.shift()).join(',')!=='true_label,predicted_label')throw Error('Use exactly these columns: true_label,predicted_label.');
  return rows.map((row,i)=>{const pair=cells(row);if(pair.length!==2||pair.some(v=>!labels.includes(v)))throw Error(`Row ${i+2}: use supported labels: ${labels.join(', ')}.`);return {actual:pair[0],predicted:pair[1]};});
}
export function evaluatePredictions(rows, labels=LABELS) {
  if(!rows.length)throw Error('There are no predictions to evaluate.');
  const matrix=labels.map(()=>labels.map(()=>0));
  rows.forEach(({actual,predicted})=>{const a=labels.indexOf(actual),p=labels.indexOf(predicted);if(a<0||p<0)throw Error('Unsupported class label.');matrix[a][p]++;});
  const perClass=labels.map((label,i)=>{const support=matrix[i].reduce((a,b)=>a+b,0);const predicted=matrix.reduce((sum,row)=>sum+row[i],0);const precision=predicted?matrix[i][i]/predicted:0;const recall=support?matrix[i][i]/support:0;const f1=precision+recall?2*precision*recall/(precision+recall):0;return {label,precision,recall,f1,support};});
  const average=key=>perClass.reduce((sum,c)=>sum+c[key],0)/labels.length;
  return {count:rows.length,accuracy:matrix.reduce((sum,row,i)=>sum+row[i],0)/rows.length,precision:average('precision'),recall:average('recall'),f1:average('f1'),matrix,perClass};
}
export const EXAMPLE_CSV='true_label,predicted_label\nhealthy,healthy\nhealthy,healthy\nhealthy,early\nearly,early\nearly,early\nearly,septoria\nseptoria,septoria\nseptoria,septoria\nseptoria,healthy\n';
