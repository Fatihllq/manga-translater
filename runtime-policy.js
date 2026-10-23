export function resourcePolicy(info=globalThis.navigator??{}) {
 const cores=Math.max(1,Number(info.hardwareConcurrency)||2);
 const ocrWorkers=cores>=8 && Number(info.deviceMemory)>=4?2:1;
 const threads=Math.min(4,Math.max(1,cores-ocrWorkers-1));
 return {ocrWorkers,threads};
}
export const abortError=()=>new DOMException('İşlem durduruldu.','AbortError');
export function checkSignal(signal){if(signal?.aborted)throw abortError();}

export function withSignal(promise,signal){
 if(!signal)return Promise.resolve(promise);
 checkSignal(signal);
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(abortError());};
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);if(!signal.aborted)resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
