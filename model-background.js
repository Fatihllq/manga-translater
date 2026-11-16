import {allowedModelSender} from './model-codec.js';
let creating;
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message?.type!=='MANGA_MODEL_HOST')return;
 if(!allowedModelSender(sender,chrome.runtime.id)){respond({ok:false,reason:'Invalid model client'});return;}
 creating??=(async()=>{
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('model-host.html')]});
  if(!contexts.length)await chrome.offscreen.createDocument({url:'model-host.html',reasons:['WORKERS','BLOBS'],justification:'Process manga text and images locally while keeping the reader visible.'});
  const result=await chrome.runtime.sendMessage({type:'MANGA_MODEL_CAPABILITIES'});
  if(!result?.isolated)throw Error('Model document is not isolated');return result;
 })().finally(()=>{creating=undefined;});
 creating.then(result=>respond(result),error=>respond({ok:false,reason:error.message}));return true;
});
