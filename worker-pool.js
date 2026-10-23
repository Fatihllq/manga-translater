import {abortError,checkSignal} from './runtime-policy.js';
// Cancellation only terminates the worker owned by the cancelled job.
export class WorkerPool {
 constructor({size,create,execute}){
  this.create=create;this.execute=execute;this.queue=[];this.sequence=0;this.closed=false;
  this.slots=Array.from({length:size},()=>({worker:null,key:null,job:null}));
 }
 run(payload,{signal,priority=0,sessionId}={}){
  checkSignal(signal);if(this.closed)return Promise.reject(abortError());
  return new Promise((resolve,reject)=>{
   const job={payload,signal,priority,sessionId,resolve,reject,sequence:++this.sequence,cancelled:false};
   job.cancellation=new Promise((_,cancel)=>{job.cancel=()=>cancel(abortError());});
   // Factory initialization is allowed to settle before a slot is reused.
   job.cancellation.catch(()=>{});
   job.abort=()=>{
    if(job.cancelled)return;job.cancelled=true;job.reject(abortError());job.cancel();
    const slot=this.slots.find(s=>s.job===job);
    if(slot?.worker){const worker=slot.worker;slot.worker=null;slot.key=null;job.termination=Promise.resolve().then(()=>worker.terminate()).catch(()=>{});}
    this.queue=this.queue.filter(j=>j!==job);this.pump();
   };
   signal?.addEventListener('abort',job.abort,{once:true});this.queue.push(job);this.pump();
  });
 }
 pump(){
  if(this.closed)return;this.queue.sort((a,b)=>a.priority-b.priority||a.sequence-b.sequence);
  for(const slot of this.slots)if(!slot.job&&this.queue.length){
   const job=this.queue.shift();if(job.cancelled)continue;slot.job=job;void this.perform(slot,job);
  }
 }
 async perform(slot,job){
  try{
   if(slot.key!==job.payload.key&&slot.worker){const prior=slot.worker;slot.worker=null;slot.key=null;await prior.terminate();}
   checkSignal(job.signal);if(job.cancelled||this.closed)throw abortError();
   if(!slot.worker){
    const worker=await this.create(job.payload);
    if(job.cancelled||this.closed){await worker.terminate();throw abortError();}
    slot.worker=worker;slot.key=job.payload.key;
   }
   const result=await Promise.race([this.execute(slot.worker,job.payload),job.cancellation]);
   checkSignal(job.signal);if(job.cancelled||this.closed)throw abortError();job.resolve(result);
  }catch(error){
   // A failed recognize may leave temporary native parameters in place.
   if(slot.worker){const prior=slot.worker;slot.worker=null;slot.key=null;job.termination=Promise.resolve().then(()=>prior.terminate()).catch(()=>{});}
   job.reject(error);
  }
  finally{await job.termination;job.signal?.removeEventListener('abort',job.abort);slot.job=null;this.pump();}
 }
 async dispose(){
  this.closed=true;
  for(const job of [...this.queue,...this.slots.map(s=>s.job).filter(Boolean)])job.abort();
  this.queue=[];
  await Promise.allSettled(this.slots.map(async slot=>{if(slot.worker){const prior=slot.worker;slot.worker=null;slot.key=null;await prior.terminate();}}));
 }
}
