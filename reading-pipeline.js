import {checkSignal,abortError} from './runtime-policy.js';
export class ReadingPipeline {
 constructor({scan,process,priority,onUpdate=()=>{},signal,maxReady=2}) {
  Object.assign(this,{scan,process,priority,onUpdate,signal,maxReady});
  this.items=new Map();this.sources=new Set();this.waiters=new Set();this.discoveryDone=false;this.incomplete=false;
  this.shown=0;this.failed=0;this.skipped=0;this.unreadable=0;this.maxBuffered=0;this.finished=false;
  this.abort=()=>this.wake();signal?.addEventListener('abort',this.abort);
 }
 add(item) {const url=item.descriptor.imageUrl;if(this.finished||this.signal?.aborted||this.items.has(item.descriptor.assetId)||url&&this.sources.has(url))return;if(url)this.sources.add(url);item.state='queued';this.items.set(item.descriptor.assetId,item);this.update();}
 finishDiscovery(incomplete=false){this.discoveryDone=true;this.incomplete ||= incomplete;this.update();}
 count(shown=0,failed=0,skipped=0){this.shown+=shown;this.failed+=failed;this.skipped+=skipped;this.update();}
 wake(){for(const resolve of this.waiters)resolve();this.waiters.clear();}
 wait(){checkSignal(this.signal);if(this.failure)throw this.failure;return new Promise(resolve=>this.waiters.add(resolve));}
 snapshot(){
  const list=[...this.items.values()];
  return {found:list.length,ready:list.filter(i=>i.state==='done').length,processed:list.filter(i=>['done','error'].includes(i.state)).length,
   buffered:list.filter(i=>i.state==='ready').length,shown:this.shown,failed:this.failed,skipped:this.skipped,unreadable:this.unreadable,discoveryDone:this.discoveryDone,incomplete:this.incomplete,
   waiting:!this.discoveryDone&&!list.some(i=>['queued','detecting','ready','processing'].includes(i.state)),maxBuffered:this.maxBuffered};
 }
 update(){const snapshot=this.snapshot();this.maxBuffered=Math.max(this.maxBuffered,snapshot.buffered);this.onUpdate({...snapshot,maxBuffered:this.maxBuffered});this.wake();}
 next(state){return [...this.items.values()].filter(i=>i.state===state).sort(this.priority)[0];}
 async detectLoop(){
  while(true){
   checkSignal(this.signal);if(this.failure)throw this.failure;
   const item=this.snapshot().buffered<this.maxReady?this.next('queued'):null;
   if(!item){if(this.discoveryDone&&!this.next('queued'))return;await this.wait();continue;}
   item.state='detecting';this.update();
   try{await this.scan(item);checkSignal(this.signal);if(this.failure)throw this.failure;item.state='ready';}
   catch(error){if(error.name==='AbortError')throw error;item.error=error.message;item.state='error';this.unreadable++;this.incomplete=true;}
   this.update();
  }
 }
 async processLoop(){
  while(true){
   checkSignal(this.signal);if(this.failure)throw this.failure;const item=this.next('ready');
   if(!item){
    if(this.discoveryDone&&![...this.items.values()].some(i=>['queued','detecting','ready'].includes(i.state)))return;
    await this.wait();continue;
   }
   item.state='processing';this.update();
   try{const result=await this.process(item,(...counts)=>this.count(...counts));checkSignal(this.signal);if(this.failure)throw this.failure;item.result=result;item.state='done';}
   catch(error){if(error.name==='AbortError')throw error;item.error=error.message;item.state='error';this.unreadable++;this.incomplete=true;}
   this.update();
  }
 }
 async run(discover){
  try{await Promise.all([this.detectLoop(),this.processLoop(),Promise.resolve().then(discover).then(result=>{if(result?.discoveryDone!==false)this.finishDiscovery(Boolean(result?.incomplete));else{this.incomplete ||= Boolean(result.incomplete);this.update();}})]);checkSignal(this.signal);if(this.failure)throw this.failure;return this.snapshot();}
  catch(error){this.failure=error;this.discoveryDone=true;this.wake();throw error;}
  finally{this.finished=true;this.signal?.removeEventListener('abort',this.abort);this.wake();}
 }
}
