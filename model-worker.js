import {encodeModelData,decodeModelData,allowedModelFile} from './model-codec.js';
// The page iframe cannot use WASM threads; the offscreen document owns its workers.
export function createModelWorker(url,options={type:'module'}){
 if(globalThis.crossOriginIsolated||!globalThis.chrome?.runtime?.connect)return new Worker(url,options);
 const parsed=new URL(url,globalThis.location?.href),file=parsed.pathname.split('/').at(-1);if(parsed.protocol!=='chrome-extension:'||parsed.host!==chrome.runtime.id||parsed.pathname!=='/'+file||parsed.search||parsed.hash||!allowedModelFile(file))throw Error('Invalid model worker');
 let port,local,closed=false,fallback=false,serial=Promise.resolve();const jobs=new Map(),sent=new Set(),proxy={onmessage:null,onerror:null};
 function deliver(data){if(closed)return;if(data.type!=='progress'){jobs.delete(data.id);sent.delete(data.id);}proxy.onmessage?.({data});}
 function native(){if(closed||local||fallback)return;fallback=true;if(port){const prior=port;port=undefined;prior.disconnect();}local=new Worker(url,options);local.onmessage=e=>deliver(e.data);local.onerror=e=>{if(!closed)proxy.onerror?.(e);};for(const data of jobs.values())if(sent.has(data.id))local.postMessage(data);}
 const ready=chrome.runtime.sendMessage({type:'MANGA_MODEL_HOST'}).then(result=>{
  if(!result?.ok||!result.isolated)throw Error(result?.reason||'Model host not isolated');if(closed)return;
  port=chrome.runtime.connect({name:'manga-model:'+crypto.randomUUID()});
  port.onMessage.addListener(async message=>{if(closed||fallback)return;if(message.kind==='error'){native();return;}try{deliver(decodeModelData(message.data));}catch{native();}});
  port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(!closed&&!fallback)native();});port.postMessage({kind:'open',file});
 }).catch(()=>native());
 proxy.postMessage=data=>{if(closed)return;jobs.set(data.id,data);serial=serial.then(async()=>{await ready;if(closed)return;if(local){local.postMessage(data);return;}try{sent.add(data.id);port.postMessage({kind:'data',data:await encodeModelData(data)});}catch{native();}}).catch(e=>{if(!closed)proxy.onerror?.({message:e.message});});};
 proxy.terminate=()=>{if(closed)return;closed=true;jobs.clear();local?.terminate();port?.disconnect();port=undefined;};
 return proxy;
}
