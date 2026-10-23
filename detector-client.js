import {resourcePolicy} from './runtime-policy.js';
let worker,pending,preparation,forceSingle=false,forceCpu=false;
export function stopDetection(){
 worker?.terminate();worker=undefined;preparation=undefined;forceSingle=false;forceCpu=false;
 if(pending){pending.reject(new DOMException('Tarama durduruldu.','AbortError'));pending=undefined;}
}
function getWorker(){
 if(worker)return worker;const created=worker=new Worker(chrome.runtime.getURL('detector-worker.js'),{type:'module'});
 created.onerror=event=>{if(worker!==created)return;const active=pending;pending=undefined;worker?.terminate();worker=undefined;preparation=undefined;active?.reject(Error(event.message||'Balon algılama çalışmadı.'));};
 created.onmessage=({data})=>{
  if(worker!==created||data.id!==pending?.id)return;const active=pending;if(data.forceCpu)forceCpu=true;
  if(data.type==='progress'){active.onProgress(data);return;}
  if(data.type==='error'&&data.retrySingleThread&&!active.retried){
   forceSingle=true;active.retried=true;worker.terminate();worker=undefined;getWorker().postMessage({...active.data,threads:1,backend:forceCpu?'wasm':active.data.backend});return;
  }
  pending=undefined;if(!active.keepAlive){worker.terminate();worker=undefined;preparation=undefined;}
  if(data.type==='error')active.reject(Error(data.message));else active.resolve(data);
 };
 return created;
}
function request(data,onProgress=()=>{},options={}){
 if(pending)return Promise.reject(Error('Önceki görselin taraması sürüyor.'));
 const activeWorker=getWorker();
 return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID(),threads=forceSingle||options.backend==='wasm-single'?1:resourcePolicy().threads;
  pending={id,resolve,reject,onProgress,keepAlive:Boolean(options.keepAlive),data:{id,...data,backend:forceCpu?'wasm':options.backend||'auto',threads}};
  activeWorker.postMessage(pending.data);
 });
}
export function prepareDetection(options={}){
 return preparation??=request({type:'prepare'},options.onProgress,{...options,keepAlive:true}).catch(error=>{preparation=undefined;throw error;});
}
export async function detectImage(blob,onProgress=()=>{},options={}){
 await preparation;return request({type:'scan',blob},onProgress,options);
}
