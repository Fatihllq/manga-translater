(() => {
 if(window===window.top)return;
 document.documentElement.dataset.surface='page';
 const instance=new URLSearchParams(location.search).get('instance');
 const surface=globalThis.__mangaPageSurface={ready:false,started:false,tab:undefined};
 let pending,lastSize;
 surface.refresh=state=>{
  if(state)surface.state=state;
  if(pending)return;
  pending=requestAnimationFrame(()=>{
   pending=undefined;
   const button=document.getElementById('pageTranslateButton');if(!button)return;
   const busy=!document.getElementById('pageStopButton').disabled;
   const original=!document.getElementById('pageOriginalButton').disabled;
   document.body.classList.toggle('widget-expanded',surface.started||busy||original);
   button.title=busy?'Çeviri sürüyor':'Sayfayı çevir';button.setAttribute('aria-label','Sayfayı çevir');button.setAttribute('aria-busy',String(busy));
   const text=document.getElementById('pageStatus').textContent,summary=document.getElementById('widgetStatus'),state=surface.state;
   if(summary&&state){
    let value=text;
    if(!/durdur|değişti|başlatılamadı|tamamlanamadı|izin|okunamadı/i.test(text)){
     value=/özgün|kaldırıldı/i.test(text)?'Özgün görseller gösteriliyor.':
      state.waiting?'Bulunan görseller çevrildi. Bölüm listesi henüz doğrulanmadı; yeni görseller bekleniyor.':
      state.busy?(state.found?'Çevriliyor: '+state.ready+' / '+state.found+' görsel · '+state.shown+' çeviri':'Bölüm hazırlanıyor…'):
      state.shown+' çeviri hazır · '+state.found+' görsel'+(state.failed?' · '+state.failed+' alan çevrilemedi':'');
    }
    if(summary.textContent!==value)summary.textContent=value;
   }
   if(!surface.ready)button.disabled=true;
   const width=surface.started||busy||original?260:64,height=Math.min(360,Math.max(64,Math.ceil(document.body.scrollHeight)));
   if(surface.tab&&lastSize!==width+':'+height){
    lastSize=width+':'+height;
    void chrome.tabs.sendMessage(surface.tab.id,{type:'MANGA_WIDGET_SIZE',instance,width,height},{frameId:0}).catch(()=>{});
   }
  });
 };
 surface.initialize=async ready=>{
  surface.tab=await chrome.tabs.getCurrent();
  if(!surface.tab?.id)throw Error('Manga sekmesi bulunamadı.');
  await ready;surface.ready=true;document.getElementById('pageTranslateButton').disabled=false;surface.refresh();
 };
 document.addEventListener('DOMContentLoaded',()=>{
  const summary=document.createElement('p');summary.id='widgetStatus';summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');document.getElementById('pageSection').append(summary);
  document.getElementById('pageTranslateButton').addEventListener('click',()=>{surface.started=true;surface.refresh();},true);
  new MutationObserver(()=>surface.refresh()).observe(document.getElementById('pageSection'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','value']});
  surface.refresh();
 });
})();
