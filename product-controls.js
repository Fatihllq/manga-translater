import {SOURCE_LANGUAGES,TARGET_LANGUAGES} from './languages.js';
import {checkTranslationAvailability} from './translation.js';
import {getReadingSettings,saveReadingSettings,listReadingHistory,clearReadingHistory,exportReadingBackup,importReadingBackup} from './reading-store.js';
import {getProductSettings,updateProductSettings,validateProductSettings,getTermMemory,glossaryKey} from './product-state.js';
import {parseTermLines,validateTermMemory} from './term-memory.js';

function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
export function initProductControls({onChange=()=>{},onExport=()=>{},onImport=()=>{},onFill=()=>{},onUndo=()=>{}}={}){
 const names=['sourceLanguage','targetLanguage','seriesName','fontFamily','fontScale','fontColor','fontAutoColor','textAlign','termLines','phraseLines','saveTermsButton','settingsStatus','readingHistory','historyClearButton','readingExportButton','readingImportFile','pagePngButton','chapterZipButton','localFiles','fillRegionButton','undoEditButton'];
 const ui=Object.fromEntries(names.map(id=>[id,document.getElementById(id)]));let availabilityEpoch=0;
 const status=text=>ui.settingsStatus.textContent=text;
 const termsText=entries=>(entries??[]).map(x=>`${x.source} => ${x.target}`).join('\n');
 function display(){
  const s=getProductSettings();ui.sourceLanguage.value=s.sourceLanguage;ui.targetLanguage.value=s.targetLanguage;ui.seriesName.value=s.series;
  ui.fontFamily.value=s.textStyle.fontFamily;ui.fontScale.value=s.textStyle.scale;ui.fontColor.value=s.textStyle.color??'#171717';ui.fontAutoColor.checked=s.textStyle.color===null;ui.fontColor.disabled=ui.fontAutoColor.checked;ui.textAlign.value=s.textStyle.align;
  const memory=getTermMemory();ui.termLines.value=termsText(memory.terms);ui.phraseLines.value=termsText(memory.phrases);
 }
 async function history(){
  const entries=await listReadingHistory();ui.readingHistory.replaceChildren();
  if(!entries.length){ui.readingHistory.textContent='Henüz kaydedilmiş çeviri yok.';return;}
  for(const entry of entries.slice(0,30)){
   const item=document.createElement('li');const value=entry.value??entry;
   const descriptor=value.descriptor??{};const title=descriptor.pageUrl??value.pageKey??value.title??'Yerel görsel';
   item.textContent=`${String(title).slice(0,110)} · ${(value.regions??[]).filter(r=>r.turkish?.trim()).length} çeviri${entry.edited?' · düzeltme korundu':''}`;
   ui.readingHistory.append(item);
  }
 }
 async function availableTargets(){
  const token=++availabilityEpoch,s=getProductSettings();ui.targetLanguage.disabled=true;status('Yerel dil desteği kontrol ediliyor…');
  const options=await Promise.all(Object.entries(TARGET_LANGUAGES).map(async([code,language])=>{
   try{return {code,language,state:code===s.sourceLanguage?'available':await checkTranslationAvailability(s.sourceLanguage,code)};}catch{return {code,language,state:'unavailable'};}
  }));
  if(token!==availabilityEpoch)return;
  ui.targetLanguage.replaceChildren();
  for(const {code,language,state}of options)if(state!=='unavailable'||code===s.targetLanguage){
   const option=document.createElement('option');option.value=code;option.textContent=language.name+(state==='unavailable'?' · kullanılamıyor':'');option.disabled=state==='unavailable';ui.targetLanguage.append(option);
  }
  ui.targetLanguage.value=s.targetLanguage;ui.targetLanguage.disabled=false;
  const state=options.find(x=>x.code===s.targetLanguage)?.state;
  status(state==='unavailable'?'Bu tarayıcıda seçilen dil çifti kullanılamıyor. Başka bir hedef dil seç.':SOURCE_LANGUAGES[s.sourceLanguage]?.beta?'Bu kaynak dil beta; OCR sonucunu kontrol et.':'Cihazda çalışır. İlk kullanımda Chrome dil paketi indirebilir.');
 }
 async function changed(){
  try{
   const prior=getProductSettings();
   const next=validateProductSettings({...prior,sourceLanguage:ui.sourceLanguage.value,targetLanguage:ui.targetLanguage.value||prior.targetLanguage,series:ui.seriesName.value.trim().slice(0,100)||'Genel',textStyle:{fontFamily:ui.fontFamily.value,scale:Number(ui.fontScale.value),color:ui.fontAutoColor.checked?null:ui.fontColor.value,align:ui.textAlign.value}});
   await saveReadingSettings(next);updateProductSettings(next);await onChange(next,prior);void chrome.runtime.sendMessage({type:'MANGA_SETTINGS_CHANGED'}).catch(()=>{});display();if(next.sourceLanguage!==prior.sourceLanguage)await availableTargets();else status('Ayarlar bu cihazda kaydedildi.');
  }catch(error){display();status('Ayar uygulanamadı: '+error.message);}
 }
 for(const [code,language]of Object.entries(SOURCE_LANGUAGES)){const option=document.createElement('option');option.value=code;option.textContent=language.name+(language.beta?' · beta':'');ui.sourceLanguage.append(option);}
 for(const id of ['sourceLanguage','targetLanguage','seriesName','fontFamily','fontScale','fontColor','fontAutoColor','textAlign'])ui[id].addEventListener('change',()=>void changed());
 ui.saveTermsButton.addEventListener('click',()=>void(async()=>{
  try{const prior=getProductSettings(),memory=validateTermMemory({terms:parseTermLines(ui.termLines.value),phrases:parseTermLines(ui.phraseLines.value)});
   const next=validateProductSettings({...prior,glossaries:{...prior.glossaries,[glossaryKey(prior)]:memory}});
   await saveReadingSettings(next);updateProductSettings(next);await onChange(next,prior);void chrome.runtime.sendMessage({type:'MANGA_SETTINGS_CHANGED'}).catch(()=>{});status('Seri sözlüğü ve onaylı ifadeler kaydedildi.');
  }catch(error){status(error.message);}
 })());
 ui.historyClearButton.addEventListener('click',()=>void clearReadingHistory().then(history).then(()=>status('Otomatik geçmiş temizlendi; kullanıcı düzeltmeleri korundu.')).catch(e=>status(e.message)));
 ui.readingExportButton.addEventListener('click',()=>void exportReadingBackup().then(value=>download(new Blob([JSON.stringify(value)],{type:'application/json'}),'manga-okuma-yedegi.json')).catch(e=>status(e.message)));
 ui.readingImportFile.addEventListener('change',()=>void(async()=>{const file=ui.readingImportFile.files?.[0];if(!file)return;try{if(file.size>128*1024*1024)throw Error('Yedek dosyası çok büyük.');const backup=JSON.parse(await file.text());validateProductSettings(backup.settings);await importReadingBackup(backup);await history();status('Okuma yedeği içe aktarıldı. Ayarları yüklemek için paneli yeniden açabilirsin.');}catch(e){status(e.message);}finally{ui.readingImportFile.value='';}})());
 const outputStatus=text=>document.getElementById('outputStatus').textContent=text;
 ui.pagePngButton.addEventListener('click',()=>void Promise.resolve(onExport(false)).then(()=>outputStatus('PNG indirmesi hazırlandı.')).catch(e=>outputStatus(e.message)));
 ui.chapterZipButton.addEventListener('click',()=>void Promise.resolve(onExport(true)).then(()=>outputStatus('Bölüm ZIP indirmesi hazırlandı.')).catch(e=>outputStatus(e.message)));
 ui.localFiles.addEventListener('change',()=>void Promise.resolve(onImport([...ui.localFiles.files])).catch(e=>outputStatus(e.message)).finally(()=>{ui.localFiles.value='';}));
 ui.fillRegionButton.addEventListener('click',()=>void Promise.resolve(onFill()).catch(e=>status(e.message)));
 ui.undoEditButton.addEventListener('click',()=>void Promise.resolve(onUndo()).catch(e=>status(e.message)));
 const ready=(async()=>{const stored=await getReadingSettings();if(stored&&Object.keys(stored).length)updateProductSettings(stored);display();await onChange(getProductSettings(),null);await availableTargets();await history();})().catch(e=>status('Ayarlar açılamadı: '+e.message));
 return {ready,refreshHistory:history,status,async reload(){await ready;const prior=getProductSettings(),stored=await getReadingSettings();updateProductSettings(stored);display();await onChange(getProductSettings(),prior);await availableTargets();}};
}
