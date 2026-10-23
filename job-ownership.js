(() => {
 if(globalThis.__mangaJobOwnership)return;
 let current;
 // tabs messages from privileged extension frames omit documentId.
 const documentKey=sender=>sender?.url?.startsWith('chrome-extension://')?sender.url:sender?.documentId;
 const denied=()=>({ok:false,reason:'Bu sekmede başka bir çeviri çalışıyor. Önce onu durdur.'});
 globalThis.__mangaJobOwnership={
  get owner(){return current?.owner;},
  claim(owner,sender){
   const documentId=documentKey(sender);
   if(typeof owner!=='string'||!owner||owner.length>100||typeof documentId!=='string'||!documentId)return denied();
   if(current&&(current.owner!==owner||current.documentId!==documentId))return denied();
   current={owner,documentId};return {ok:true};
  },
  allows(message,sender){return !current||current.owner===message.jobOwner&&current.documentId===documentKey(sender);},
  releaseController(owner,sender){if(current?.owner.split(':')[0]===owner.split(':')[0]&&current.documentId===documentKey(sender))current=undefined;},
  release(owner,sender){if(current?.owner===owner&&current.documentId===documentKey(sender))current=undefined;return {ok:true};},
 };
})();
