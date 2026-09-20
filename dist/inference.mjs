let pending;
// Separable, antialiased bilinear resize using Pillow's 22-bit coefficient rounding.
// Matching training preprocessing avoids browser-specific canvas downsampling.
export function resizeRGB(rgba,width,height,size){
  const coefficients=(source,target)=>Array.from({length:target},(_,i)=>{
    const scale=source/target,support=Math.max(1,scale),center=(i+.5)*scale;
    const start=Math.max(0,Math.trunc(center-support+.5)),end=Math.min(source,Math.trunc(center+support+.5));
    const weights=Array.from({length:end-start},(_,j)=>Math.max(0,1-Math.abs((j+start-center+.5)/support)));
    const sum=weights.reduce((a,b)=>a+b,0);
    return {start,weights:weights.map(v=>Math.floor(v/sum*4194304+.5))};
  });
  const horizontal=coefficients(width,size),vertical=coefficients(height,size),middle=new Uint8Array(size*height*3),output=new Uint8Array(size*size*3);
  for(let y=0;y<height;y++)for(let x=0;x<size;x++)for(let c=0;c<3;c++){
    const {start,weights}=horizontal[x];let value=2097152;
    for(let k=0;k<weights.length;k++)value+=rgba[(y*width+start+k)*4+c]*weights[k];
    middle[(y*size+x)*3+c]=Math.max(0,Math.min(255,Math.floor(value/4194304)));
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(let c=0;c<3;c++){
    const {start,weights}=vertical[y];let value=2097152;
    for(let k=0;k<weights.length;k++)value+=middle[((start+k)*size+x)*3+c]*weights[k];
    output[(y*size+x)*3+c]=Math.max(0,Math.min(255,Math.floor(value/4194304)));
  }
  return output;
}
export function calibratedProbabilities(logits, temperature=1){
  if(!Number.isFinite(temperature)||temperature<=0||!logits.length||!Array.from(logits).every(Number.isFinite))throw Error('Invalid model output.');
  const values=Array.from(logits,x=>x/temperature),top=Math.max(...values),exp=values.map(x=>Math.exp(x-top)),sum=exp.reduce((a,b)=>a+b,0);
  return exp.map(x=>x/sum);
}
export function interpret(logits,metadata,crop){
  if(logits.length!==metadata.classes.length)throw Error('Model class order does not match its output.');
  const probabilities=calibratedProbabilities(logits,metadata.temperature);
  const index=probabilities.indexOf(Math.max(...probabilities));
  const label=metadata.classes[index], mismatch=!label.startsWith(crop+'_');
  return {label,confidence:probabilities[index],probabilities,classes:metadata.classes,
    accepted:!mismatch&&probabilities[index]>=metadata.threshold,
    reason:mismatch?'The predicted crop differs from your selection. Confirm the crop and retake the photo.':probabilities[index]<metadata.threshold?'The model is uncertain. Retake the photo or ask an agricultural specialist.':'This is a model prediction, not a confirmed diagnosis.',
    model:metadata.architecture,version:metadata.version,threshold:metadata.threshold};
}
async function load(){
  if(!pending)pending=(async()=>{
    const ort=await import('./vendor/ort.wasm.min.mjs');
    ort.env.wasm.numThreads=1;
    ort.env.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
    const response=await fetch(new URL('./model/metadata.json',import.meta.url));
    if(!response.ok)throw Error('The model metadata could not be loaded.');
    const metadata=await response.json();
    const weights=await fetch(new URL('./model/leaflens.onnx',import.meta.url));
    if(!weights.ok)throw Error('The model file could not be loaded.');
    const bytes=await weights.arrayBuffer();
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
    if(digest!==metadata.sha256)throw Error('Model integrity check failed. Reload the website.');
    const session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm']});
    return {ort,session,metadata};
  })().catch(error=>{pending=null;throw error;});
  return pending;
}
export async function predict(imageURL,crop){
  const {ort,session,metadata}=await load();
  const image=new Image();image.src=imageURL;await image.decode();
  const n=metadata.image_size,canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(image,0,0);
  const rgba=context.getImageData(0,0,canvas.width,canvas.height).data,rgb=resizeRGB(rgba,canvas.width,canvas.height,n),values=new Float32Array(n*n*3);
  for(let i=0;i<n*n;i++)for(let c=0;c<3;c++)values[c*n*n+i]=(rgb[i*3+c]/255-metadata.mean[c])/metadata.std[c];
  const result=await session.run({images:new ort.Tensor('float32',values,[1,3,n,n])});
  return interpret(result.logits.data,metadata,crop);
}
