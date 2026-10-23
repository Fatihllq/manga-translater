export function createPaddleWorker(sourceLanguage='en'){
 const worker=new Worker(new URL('./paddle-worker.js',import.meta.url),{type:'module'}),pending=new Map();let serial=0;
 worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data.result);};
 worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message||'Paddle OCR çalışanı durdu.'));pending.clear();};
 return {recognize(imageDataUrl,path,rowBoxes){return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({id,imageDataUrl,path,rowBoxes,sourceLanguage});});},
  prepare(){return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({id,prepare:true,sourceLanguage});});},
  async terminate(){worker.terminate();for(const p of pending.values())p.reject(new DOMException('Durduruldu.','AbortError'));pending.clear();}};
}
