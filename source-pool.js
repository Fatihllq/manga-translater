import {abortError,checkSignal} from './runtime-policy.js';
// One decoded panel source and one detector bitmap may coexist.
export class SourcePool {
 constructor(load,close){this.load=load;this.close=close;this.entries=new Map();this.queue=[];}
 acquire(item,{signal,priority=1}={}){
  checkSignal(signal);const key=item.descriptor.assetId,entry=this.entries.get(key);
  if(entry&&!entry.closing)return this.lease(entry,signal);
  return new Promise((resolve,reject)=>{
   const request={item,key,signal,priority,resolve,reject};
   request.abort=()=>{this.queue=this.queue.filter(r=>r!==request);reject(abortError());};
   signal?.addEventListener('abort',request.abort,{once:true});this.queue.push(request);this.pump();
  });
 }
 lease(entry,signal){
  entry.refs++;
  return new Promise((resolve,reject)=>{
   let released=false,settled=false;
   const release=()=>{if(released)return;released=true;signal?.removeEventListener('abort',abort);this.release(entry);};
   const abort=()=>{if(!settled){settled=true;reject(abortError());}release();};
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted){abort();return;}
   entry.promise.then(source=>{
    if(settled)return;
    if(entry.closing||signal?.aborted){abort();return;}
    settled=true;resolve({source,release});
   },error=>{if(!settled){settled=true;reject(error);}release();});
  });
 }
 release(entry){if(--entry.refs===0)this.retire(entry);}
 retire(entry){
  if(entry.closing)return;entry.closing=true;entry.controller.abort();
  void entry.promise.then(source=>{this.close(source);}).catch(()=>{}).finally(()=>{
   if(this.entries.get(entry.key)===entry)this.entries.delete(entry.key);this.pump();
  });
 }
 pump(){
  if(this.entries.size||!this.queue.length)return;
  this.queue.sort((a,b)=>a.priority-b.priority);
  const request=this.queue.shift();request.signal?.removeEventListener('abort',request.abort);
  if(request.signal?.aborted){request.reject(abortError());this.pump();return;}
  const entry={key:request.key,refs:0,closing:false,controller:new AbortController()};
  this.entries.set(entry.key,entry);
  entry.promise=Promise.resolve().then(()=>{checkSignal(entry.controller.signal);return this.load(request.item,entry.controller.signal);});
  this.lease(entry,request.signal).then(request.resolve,request.reject);
  for(const r of [...this.queue])if(r.key===entry.key){
   this.queue.splice(this.queue.indexOf(r),1);r.signal?.removeEventListener('abort',r.abort);
   this.lease(entry,r.signal).then(r.resolve,r.reject);
  }
 }
 clear(){
  for(const r of this.queue){r.signal?.removeEventListener('abort',r.abort);r.reject(abortError());}
  this.queue=[];for(const entry of this.entries.values())this.retire(entry);
 }
}
