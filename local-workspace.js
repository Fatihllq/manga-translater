import {prepareRegion,stopInpainting} from './inpaint-client.js';
import {detectImage,stopDetection} from './detector-client.js';
import {loadSourceImage,cropSourceImage} from './crop.js';
import {recognize,prepareOcr} from './ocr.js';
import {prepareTranslator,translate} from './translation.js';
import {automaticEligibility} from './automatic-eligibility.js';
import {getTargetLanguage} from './languages.js';
import {renderPage} from './page-renderer.js';
import {loadReading,saveReading,saveReadingEdit} from './reading-store.js';
import {getProductSettings,getTermMemory} from './product-state.js';
import {pageReadingKey} from './reading-identity.js';
import {createArchive,downloadBlob} from './archive.js';

function element(tag,text,attributes={}){
 const node=document.createElement(tag);if(text!==undefined)node.textContent=text;
 for(const [key,value]of Object.entries(attributes))node.setAttribute(key,value);return node;
}
function abortIf(signal){if(signal?.aborted)throw new DOMException('Durduruldu.','AbortError');}
function readingValue(page,settings){return {name:page.name,pageKey:'local:'+page.hash,sourceHash:page.hash,sourceLanguage:settings.sourceLanguage,targetLanguage:settings.targetLanguage,regions:page.regions};}

export async function openLocalWorkspace(imported,{getSettings=getProductSettings,onStatus=()=>{}}={}){
 if(!Array.isArray(imported)||!imported.length||imported.some(page=>!(page.blob instanceof Blob)))throw Error('Yerel çalışma alanı için görselleri seç.');
 const pages=imported.map(page=>({...page,regions:[],revision:0}));let index=0,controller,original=false,previewUrl,closed=false;
 const dialog=element('dialog',undefined,{'aria-labelledby':'mangaLocalTitle'});
 Object.assign(dialog.style,{width:'min(1100px,94vw)',maxHeight:'94vh',padding:'18px',border:'1px solid #64748b',borderRadius:'12px',background:'#fff',color:'#172033'});
 const heading=element('h2','Yerel manga çalışma alanı',{id:'mangaLocalTitle'}),close=element('button','Kapat',{type:'button'});
 const select=element('select',undefined,{'aria-label':'Yerel sayfa'});
 pages.forEach((page,i)=>select.append(element('option',`${i+1}. ${page.name}`,{value:String(i)})));
 select.style.maxWidth='100%';
 const status=element('p','Sayfa seç, ardından çevir. PNG/JPEG/WebP ve ZIP/CBZ dosyaları cihazında işlenir.',{role:'status','aria-live':'polite'});
 const actions=element('div'),current=element('button','Bu sayfayı çevir',{type:'button'}),all=element('button','Bütün sayfaları çevir',{type:'button'}),stop=element('button','Durdur',{type:'button'}),toggle=element('button','Özgünü göster',{type:'button'}),png=element('button','PNG indir',{type:'button'}),zip=element('button','Bölümü ZIP indir',{type:'button'});
 Object.assign(actions.style,{display:'flex',flexWrap:'wrap',gap:'8px',margin:'12px 0'});actions.append(current,all,stop,toggle,png,zip);
 const progress=element('progress',undefined,{'aria-label':'Yerel bölüm ilerlemesi'});progress.hidden=true;
 const preview=element('img',undefined,{alt:'Özgün manga sayfası'});Object.assign(preview.style,{maxWidth:'100%',height:'auto',display:'block',margin:'auto'});
 const editor=element('section',undefined,{'aria-label':'Yerel çeviri düzeltmeleri'});
 dialog.append(heading,close,select,status,actions,progress,preview,editor);document.body.append(dialog);
 const say=text=>{if(!closed){status.textContent=text;onStatus(text);}};
 const active=()=>pages[index];
 const pending=page=>!page.output||page.regions.some(region=>region.selected!==false&&!region.skipReason&&(!region.turkish?.trim()||region.error));
 function buttons(){
  const busy=Boolean(controller);current.disabled=all.disabled=select.disabled=busy;stop.disabled=!busy;
  png.disabled=pending(active())||busy;zip.disabled=busy||pages.some(pending);toggle.disabled=!active().output;
 }
 function showPreview(){
  if(closed)return;const page=active();if(previewUrl)URL.revokeObjectURL(previewUrl);
  previewUrl=URL.createObjectURL(!original&&page.output?page.output:page.blob);preview.src=previewUrl;
  preview.alt=(!original&&page.output?'Çevrilmiş: ':'Özgün: ')+page.name;toggle.textContent=original?'Çeviriyi göster':'Özgünü göster';buttons();
 }
 async function redraw(page,settings=getSettings()){
  const revision=++page.revision,output=await renderPage(page.blob,page.regions,{style:settings.textStyle});
  if(closed||revision!==page.revision)return;page.output=output;if(active()===page)showPreview();
 }
 async function saveEdit(page,settings){
  if(!page.key)return;await saveReading(page.key,readingValue(page,settings));await saveReadingEdit(page.key,page.regions);
 }
 function showEditor(){
  editor.replaceChildren();const page=active();
  if(!page.regions.length){editor.append(element('p','Alanlar sayfa tarandıktan sonra burada görünür.'));return;}
  editor.append(element('h3','Metinleri düzelt'),element('p','Ctrl+Enter ile kaydet; Escape ile son değişikliği iptal et. Düzeltmeler eğitim kaydı oluşturmaz.'));
  for(const [i,region]of page.regions.entries()){
   const row=element('fieldset'),legend=element('legend',`${i+1}. alan`),choice=element('input',undefined,{type:'checkbox','aria-label':`${i+1}. alanı göster`});
   choice.checked=region.selected!==false;choice.disabled=Boolean(controller);
   const sourceLabel=element('label','Kaynak metin'),source=element('textarea',region.english??'',{'aria-label':`${i+1}. kaynak metin`,rows:'2'});
   const targetLabel=element('label','Çeviri'),target=element('textarea',region.turkish??'',{'aria-label':`${i+1}. çeviri`,rows:'2'});
   for(const input of [source,target]){input.disabled=Boolean(controller);input.style.width='100%';input.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.stopPropagation();input.value=input===source?region.english??'':region.turkish??'';input.blur();}
    if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();input.blur();}
   });}
   const changed=async(type)=>{
    const settings=getSettings();
    try{
     if(type==='source'){region.english=source.value;region.sourceCorrected=true;region.turkish='';target.value='';}
     if(type==='target'){region.turkish=target.value;region.targetCorrected=true;delete region.error;delete region.skipReason;}
     if(type==='choice'){region.selected=choice.checked;region.automaticOverride=choice.checked;if(choice.checked)delete region.skipReason;}
     page.edited=true;page.output=undefined;buttons();say('Düzeltme kaydediliyor…');await redraw(page,settings);await saveEdit(page,settings);say('Düzeltmen bu cihazda kaydedildi.');
    }catch(error){say('Düzeltme kaydedilemedi: '+error.message);}
   };
   source.addEventListener('change',()=>void changed('source'));target.addEventListener('change',()=>void changed('target'));choice.addEventListener('change',()=>void changed('choice'));
   sourceLabel.append(source);targetLabel.append(target);row.append(legend,choice,sourceLabel,targetLabel);
   if(region.cleanupPatch?.warning)row.append(element('p',region.cleanupPatch.warning));
   if(region.error||region.skipReason)row.append(element('p',region.error??'Otomatik atlandı: '+region.skipReason));editor.append(row);
  }
 }
 async function processPage(page,settings,signal){
  abortIf(signal);
  page.hash??=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await page.blob.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');abortIf(signal);
  const key=await pageReadingKey(page.hash,settings);
  if(page.key!==key){
   const saved=await loadReading(key);abortIf(signal);page.key=key;page.regions=saved?.regions??[];page.edited=Boolean(saved?.edited);page.output=undefined;
  }
  if(!page.regions.length){
   const detected=await detectImage(page.blob,p=>say(page.name+': '+p.message),{keepAlive:true});abortIf(signal);
   page.regions=detected.regions.map((region,i)=>({...region,id:'local:'+i,revision:0,editRevision:0,selected:Boolean(region.selected&&!region.fallback),sourceLanguage:settings.sourceLanguage,targetLanguage:settings.targetLanguage,targetDirection:getTargetLanguage(settings.targetLanguage).direction}));
  }
  const source=await loadSourceImage(page.blob,{signal});let failed=0,shown=0;
  try{
   for(const region of page.regions){
    abortIf(signal);if(region.selected===false)continue;
    try{
     const crop=await cropSourceImage(source.image,region.bounds,{signal});abortIf(signal);region.crop=crop;region.background=crop.background.color;region.textColor=crop.background.textColor;region.flat=crop.background.flatForAutomatic;
     if(region.english===undefined){region.ocr=await recognize(crop.imageDataUrl,settings.sourceLanguage,{ocrInput:crop.ocrInput,layout:crop.ocrLayout,signal,priority:0});abortIf(signal);region.english=region.ocr.text;}
     const eligibility=automaticEligibility(region);if(!eligibility.eligible){region.skipReason=eligibility.reason;continue;}delete region.skipReason;
     if(!region.english?.trim()&&!region.turkish?.trim())throw Error('Metin okunamadı; kaynak metni elle düzeltebilirsin.');
     if(!region.turkish?.trim())region.turkish=await translate(region.english,settings.sourceLanguage,settings.targetLanguage,()=>{},{signal,priority:0,termMemory:getTermMemory(settings)});abortIf(signal);
     await prepareRegion(region,crop,{signal});abortIf(signal);delete region.error;shown++;
    }catch(error){if(error.name==='AbortError')throw error;region.error=error.message;failed++;}
    finally{if(region.crop){delete region.crop.imageDataUrl;delete region.crop.ocrInput;}}
   }
   abortIf(signal);await redraw(page,settings);abortIf(signal);await saveReading(page.key,readingValue(page,settings));if(page.edited)await saveReadingEdit(page.key,page.regions);
   page.failed=failed;return {shown,failed};
  }finally{URL.revokeObjectURL(source.url);}
 }
 async function run(everyPage){
  if(controller)return;const settings=structuredClone(getSettings());let preparing;
  try{preparing=prepareTranslator(settings.sourceLanguage,settings.targetLanguage,percent=>say('Yerel dil paketi hazırlanıyor: %'+percent));}catch(error){say(error.message);return;}
  controller=new AbortController();const signal=controller.signal;buttons();showEditor();progress.hidden=false;progress.max=everyPage?pages.length:1;progress.value=0;let shown=0,failed=0;
  try{
   await preparing;abortIf(signal);await prepareOcr(settings.sourceLanguage,{signal});
   const targets=everyPage?pages:[active()];
   for(const page of targets){
    abortIf(signal);say(`${page.name} çevriliyor (${progress.value+1}/${targets.length})…`);
    const result=await processPage(page,settings,signal);shown+=result.shown;failed+=result.failed;progress.value++;
   }
   say(`${targets.length} sayfa işlendi; ${shown} çeviri gösterildi${failed?`, ${failed} alan elle kontrol bekliyor`:''}.`);
  }catch(error){say(error.name==='AbortError'?'İşlem durduruldu. Tamamlanan sayfalar korundu.':'İşlem tamamlanamadı: '+error.message);}
  finally{controller=undefined;progress.hidden=true;buttons();showEditor();showPreview();}
 }
 function cancel(){controller?.abort();stopDetection();stopInpainting();}
 current.addEventListener('click',()=>void run(false));all.addEventListener('click',()=>void run(true));stop.addEventListener('click',cancel);
 select.addEventListener('change',()=>{index=Number(select.value);original=false;showPreview();showEditor();});toggle.addEventListener('click',()=>{original=!original;showPreview();});
 png.addEventListener('click',()=>{if(!pending(active()))downloadBlob(active().output,active().name.split('/').at(-1).replace(/\.[^.]+$/,'')+'-ceviri.png');});
 zip.addEventListener('click',()=>void(async()=>{
  try{
   const incomplete=pages.filter(pending);if(incomplete.length){say(`${incomplete.length} sayfa eksik veya hatalı. İndirilecek ZIP için önce bu sayfaları tamamla.`);return;}
   downloadBlob(await createArchive(pages.map(page=>({name:page.name,blob:page.output}))),'manga-ceviri.zip');
  }catch(error){say(error.message);}
 })());
 close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{closed=true;cancel();if(previewUrl)URL.revokeObjectURL(previewUrl);dialog.remove();});
 dialog.showModal();showPreview();showEditor();return dialog;
}
