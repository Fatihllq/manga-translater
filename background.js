function configureAction(){
 chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(console.error);
}
configureAction();chrome.runtime.onInstalled.addListener(configureAction);
chrome.action.onClicked.addListener(tab=>{
 if(!tab?.id||!tab.windowId)return;
 const opening=chrome.sidePanel.open({windowId:tab.windowId});
 const injecting=chrome.scripting.executeScript({target:{tabId:tab.id},files:['features.js','job-ownership.js','text-layout.js','overlay-manager.js','content.js','bounded-response.js','page-collector.js','automatic-content.js','page-launcher.js']});
 void Promise.allSettled([opening,injecting]).then(results=>{for(const result of results)if(result.status==='rejected')console.error(result.reason);});
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message?.type==='MANGA_QUERY_READERS'&&sender.id===chrome.runtime.id&&sender.tab?.id&&sender.frameId===0&&/^https?:/.test(sender.url||'')){
  chrome.tabs.sendMessage(sender.tab.id,{type:'MANGA_READER_PROBE'}).then(()=>respond({ok:true}),()=>respond({ok:false}));return true;
 }
 if(message?.type==='MANGA_READER_PRESENCE'&&sender.id===chrome.runtime.id&&sender.tab?.id&&sender.frameId>0&&/^https?:/.test(sender.url||'')){
  chrome.tabs.sendMessage(sender.tab.id,{type:'MANGA_READER_FRAME',frameId:sender.frameId,url:sender.url,present:message.present===true},{frameId:0}).then(()=>respond({ok:true}),()=>respond({ok:false}));return true;
 }
 if(message?.type==='MANGA_WIDGET_HIDE'&&sender.id===chrome.runtime.id&&sender.tab?.id&&sender.frameId===0){
  chrome.tabs.sendMessage(sender.tab.id,{type:'MANGA_WIDGET_STOP',instance:message.instance}).then(()=>respond({ok:true}),()=>respond({ok:false}));return true;
 }
 if(message?.type==='MANGA_SETTINGS_CHANGED'&&sender.id===chrome.runtime.id&&sender.url?.startsWith(chrome.runtime.getURL('panel.html'))){
  void chrome.runtime.sendMessage({type:'MANGA_SETTINGS_REFRESH'}).catch(()=>{});respond({ok:true});
 }
});
