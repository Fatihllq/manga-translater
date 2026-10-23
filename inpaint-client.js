import {dilate} from './pixel-masks.js';
import {maskPixels} from './inplace-geometry.js';
import {checkSignal,resourcePolicy} from './runtime-policy.js';
let worker,active,tail=Promise.resolve();
const cache=new WeakMap();
export const INPAINT_VERSION='migan-512-v2-mask-composite-v1';
export function stopInpainting(){worker?.terminate();worker=undefined;if(active){const prior=active;active=undefined;prior.reject(new DOMException('Temizleme durduruldu.','AbortError'));}}
function infer(image,mask,width,height,signal){
 const task=tail.catch(()=>{}).then(()=>{
  checkSignal(signal);
  return new Promise((resolve,reject)=>{
   const id=crypto.randomUUID();let timer;
   const finish=(error,result)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);active=undefined;error?reject(error):resolve(result);};
   const abort=()=>{worker?.terminate();worker=undefined;finish(new DOMException('Temizleme durduruldu.','AbortError'));};
   worker??=new Worker(new URL('./inpaint-worker.js',import.meta.url),{type:'module'});
   worker.onmessage=({data})=>{if(data.id!==id)return;finish(data.error?Error(data.error):null,data.result);};
   worker.onerror=event=>{worker?.terminate();worker=undefined;finish(Error(event.message||'Yerel temizleme çalışmadı.'));};
   timer=setTimeout(()=>{worker?.terminate();worker=undefined;finish(Error('Yerel temizleme zaman sınırına ulaştı.'));},60000);
   active={reject:error=>finish(error)};signal?.addEventListener('abort',abort,{once:true});
   worker.postMessage({id,image,mask,width,height,threads:resourcePolicy().threads},[image.buffer,mask.buffer]);
  });
 });tail=task;return task;
}
export function compositeMasked(rgba,predicted,mask,width,height,flatColor){
 const count=width*height,result=new Uint8ClampedArray(count*4);
 if(rgba.length!==count*4||mask.length!==count||predicted&&predicted.length!==count*3)throw Error('Temizleme piksel boyutu geçersiz.');
 for(let i=0;i<count;i++)if(mask[i]===0){for(let c=0;c<3;c++)result[i*4+c]=predicted?predicted[c*count+i]:flatColor[c];result[i*4+3]=rgba[i*4+3];}
 return result;
}
export async function prepareRegion(region,crop,{signal}={}){
 checkSignal(signal);
 const key=JSON.stringify([INPAINT_VERSION,region.bounds,region.revision,region.ocr?.lines??region.erasePolygons,region.background,crop?.sourceBounds]);
 if(region.cleanupPatch?.key===key)return region.cleanupPatch;
 const prior=cache.get(region);if(prior?.key===key)return prior.promise;
 const promise=(async()=>{
  if(!crop?.imageDataUrl)throw Error('Temizlenecek özgün kırpım bulunamadı.');
  const blob=await(await fetch(crop.imageDataUrl)).blob(),image=await createImageBitmap(blob);checkSignal(signal);
  try{
   const width=image.width,height=image.height,canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});
   ctx.drawImage(image,0,0);const original=ctx.getImageData(0,0,width,height),mask=maskPixels(region,width,height),rgb=new Uint8Array(width*height*3);
   for(let i=0;i<mask.length;i++)for(let c=0;c<3;c++)rgb[c*mask.length+i]=original.data[i*4+c];
   const geometry=region.displayGeometry,origin=crop.sourceBounds??region.bounds,closed=geometry?.mode==='inside'&&globalThis.__mangaTextLayout.safeMask(geometry.clipPath);
   let interior;if(closed){const area=new OffscreenCanvas(width,height),c=area.getContext('2d');c.setTransform(width/origin.width,0,0,height/origin.height,-origin.x*width/origin.width,-origin.y*height/origin.height);c.fill(new Path2D(geometry.clipPath));interior=c.getImageData(0,0,width,height).data;}
   const color=(closed?geometry.background:null)??crop.background?.color??region.background??'#fff';ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const flatColor=ctx.getImageData(0,0,1,1).data;
   let predicted,warning,mode='flat';let known=0,matching=0;for(let i=0;i<mask.length;i++)if(mask[i]===255&&(!interior||interior[i*4+3]===255)){known++;const p=i*4;if(Math.abs(original.data[p]-flatColor[0])+Math.abs(original.data[p+1]-flatColor[1])+Math.abs(original.data[p+2]-flatColor[2])<24)matching++;}
   const flat=crop.background?.flatForAutomatic===true||region.flat===true||known>20&&matching/known>.97;
   if(flat&&interior){const ink=new Uint8Array(mask.length);for(let i=0;i<mask.length;i++){const p=i*4;if(interior[p+3]===255&&Math.abs(original.data[p]-flatColor[0])+Math.abs(original.data[p+1]-flatColor[1])+Math.abs(original.data[p+2]-flatColor[2])>30)ink[i]=1;}const expanded=dilate(ink,width,height,1);for(let i=0;i<mask.length;i++)if(expanded[i]&&interior[i*4+3]===255)mask[i]=0;}
   if(!flat)try{predicted=await infer(rgb,mask.slice(),width,height,signal);mode='migan';}catch(error){if(error.name==='AbortError')throw error;warning='Zemin temizliği yerel dolgu ile tamamlandı: '+error.message;mode='flat-fallback';}
   checkSignal(signal);
   const pixels=compositeMasked(original.data,predicted,mask,width,height,flatColor);ctx.putImageData(new ImageData(pixels,width,height),0,0);
   const result=await canvas.convertToBlob({type:'image/png'}),dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(result);});checkSignal(signal);
   const dark=(flatColor[0]*299+flatColor[1]*587+flatColor[2]*114)/1000>=145;const samples=[];
   for(let i=0;i<mask.length;i++)if(mask[i]===0){const p=i*4,lum=(original.data[p]*299+original.data[p+1]*587+original.data[p+2]*114)/1000;if(dark?lum<90:lum>190)samples.push([original.data[p],original.data[p+1],original.data[p+2]]);}
   const foreground=samples.length?Array.from({length:3},(_,c)=>{const values=samples.map(p=>p[c]).sort((a,b)=>a-b);return values[Math.floor(values.length/2)];}):dark?[23,23,23]:[255,255,255];
   const lines=(region.ocr?.lines??[]).filter(l=>l.bbox&&l.text?.trim());let alignment='center';
   if(lines.length>1){const spread=values=>Math.max(...values)-Math.min(...values),left=spread(lines.map(l=>l.bbox.x0)),right=spread(lines.map(l=>l.bbox.x1)),tolerance=Math.max(3,lines.reduce((sum,l)=>sum+l.bbox.y1-l.bbox.y0,0)/lines.length*.25);if(left<tolerance&&right>tolerance*1.5)alignment='left';else if(right<tolerance&&left>tolerance*1.5)alignment='right';}
   const sizes=lines.map(l=>region.ocr?.writingMode==='vertical-rl'?Math.min(l.bbox.x1-l.bbox.x0,l.bbox.y1-l.bbox.y0):l.bbox.y1-l.bbox.y0).filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b);
   region.appearance={...region.appearance,alignment,fontSize:sizes.length?sizes[Math.floor(sizes.length/2)]*1.15:undefined,color:'rgb('+foreground.join(',')+')',strokeColor:dark?'#fff':'#171717',outlined:!flat};
   const bounds=crop.sourceBounds??region.bounds??{x:0,y:0,width,height};
   region.cleanupPatch={key,dataUrl,bounds:{...bounds},mode,warning};return region.cleanupPatch;
  }finally{image.close();}
 })();cache.set(region,{key,promise});try{return await promise;}catch(error){cache.delete(region);throw error;}
}
