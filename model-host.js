import {encodeModelData,decodeModelData,allowedModelFile,allowedModelSender} from './model-codec.js';
const workers=new Map();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{if(message?.type==='MANGA_MODEL_CAPABILITIES'&&sender.id===chrome.runtime.id){respond({ok:true,isolated:crossOriginIsolated,workers:workers.size});}});
chrome.runtime.onConnect.addListener(port=>{
 if(!port.name.startsWith('manga-model:')||!allowedModelSender(port.sender,chrome.runtime.id)){port.disconnect();return;}
 let worker,closed=false,tail=Promise.resolve();
 const fail=message=>{if(!closed)port.postMessage({kind:'error',message:String(message)});};
 port.onDisconnect.addListener(()=>{closed=true;worker?.terminate();workers.delete(port);});
 port.onMessage.addListener(message=>{
  tail=tail.then(async()=>{
   if(closed)return;
   if(message?.kind==='open'){
    if(worker||!allowedModelFile(message.file)||workers.size>=8)throw Error('Invalid or excessive model worker request');
    worker=new Worker(new URL(message.file,import.meta.url),{type:'module'});workers.set(port,worker);
    worker.onmessage=async({data})=>{try{const encoded=await encodeModelData(data);if(!closed)port.postMessage({kind:'data',data:encoded});}catch(e){fail(e.message);}};
    worker.onerror=e=>fail(e.message||'Model worker failed');return;
   }
   if(message?.kind!=='data'||!worker)throw Error('Model worker not ready');
   worker.postMessage(decodeModelData(message.data));
  }).catch(e=>fail(e.message));
 });
});
