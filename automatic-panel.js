import './bounded-response.js';
import {prepareRegion,stopInpainting} from './inpaint-client.js';
import './features.js';
import {detectImage,stopDetection,prepareDetection} from './detector-client.js';
import {loadSourceImage,cropSourceImage} from './crop.js';
import {recognize,prepareOcr,disposeOcr} from './ocr.js';
import {ReadingPipeline} from './reading-pipeline.js';
import {SourcePool} from './source-pool.js';
import {resourcePolicy,withSignal} from './runtime-policy.js';
import {prepareTranslator,translate} from './translation.js';
import {unionBounds,clampBounds} from './detection-geometry.js';
import {automaticEligibility} from './automatic-eligibility.js';
import {getProductSettings,getTermMemory} from './product-state.js';
import {getTargetLanguage} from './languages.js';
import {pageReadingKey} from './reading-identity.js';
import {loadReading,saveReading,saveReadingEdit} from './reading-store.js';
import {renderPage} from './page-renderer.js';
const ids=['autoFindButton','autoPermissionButton','autoStatus','autoSummary','autoRegions','autoTranslateButton','autoStopButton','autoAddButton','autoMergeButton','autoSplitButton','autoOriginalButton','autoBoxesButton','autoImageSelect','pageTranslateButton','pageStopButton','pageOriginalButton','pageStatus','pageProgress'];
const scripts=['features.js','job-ownership.js','text-layout.js','overlay-manager.js','content.js','bounded-response.js','page-collector.js','automatic-content.js'];
export function initAutomatic(callbacks){
 const ui=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
 const assets=new Map(),ports=new Map(),blobs=new Map(),missingOrigins=new Set(),editCache=new Map();
 let tabId,activeId,epoch=0,job,focusId,focusSerial=0,editor=true,preview,blobBytes=0;
 let incompleteChapter=false,lease;
 const surface=globalThis.__mangaPageSurface;
 const panelSession=crypto.randomUUID(),layoutSessions=new Map();
 const undoEdits=[];
 const settingsFor=item=>item.settings??=structuredClone(getProductSettings());
 async function readingKey(item){
  item.readingKey??=await pageReadingKey(item.sourceHash,settingsFor(item));
  return item.readingKey;
 }
 async function persist(item,edited=false){
  if(!item?.sourceHash)return;
  const key=await readingKey(item),value={sourceHash:item.sourceHash,descriptor:item.descriptor,detector:item.detector,settings:settingsFor(item),regions:item.regions.map(r=>({...r,ocrPromise:undefined,record:undefined,crop:undefined}))};
  item.saveQueue=(item.saveQueue??Promise.resolve()).catch(()=>{}).then(async()=>{if(!edited||item.persistedKey!==key){await saveReading(key,value);item.persistedKey=key;}if(edited)await saveReadingEdit(key,value.regions);});
  try{await item.saveQueue;callbacks.onStored?.();}catch(error){status('Okuma kaydı saklanamadı: '+error.message);throw error;}
 }
 const saveEdit=item=>{void persist(item,true).catch(()=>{});};
 function rememberUndo(r){undoEdits.push({id:r.id,assetId:r.assetId,english:r.english,turkish:r.turkish,sourceCorrected:r.sourceCorrected,targetCorrected:r.targetCorrected,drawingEdits:structuredClone(r.drawingEdits??[])});if(undoEdits.length>50)undoEdits.shift();}
 const layoutSession=token=>panelSession+':'+token;
 async function prepareLayout(frameId,token){
  check(token);let pending=layoutSessions.get(frameId);
  if(pending?.token!==token){const promise=frameMessage(frameId,'AUTO_LAYOUT_SESSION',{layoutSession:layoutSession(token)});pending={token,promise};layoutSessions.set(frameId,pending);}
  const response=await pending.promise;check(token);
  if(!response?.ok)throw new DOMException(response?.reason||'Yerleştirme oturumu durduruldu.','AbortError');
 }
 const all=()=>[...assets.values()].flatMap(a=>a.regions);
 const owner=r=>assets.get(r.assetId);
 const find=id=>all().find(r=>r.id===id);
 const check=token=>{if(token!==epoch)throw new DOMException('İşlem durduruldu.','AbortError');};
 let pendingStatus,pendingProgress;
 const status=text=>{if(job?.kind==='page'&&job.counts){const c=job.counts;text+=' · '+c.found+' görsel bulundu / '+c.ready+' hazır / '+c.shown+' çeviri gösteriliyor'+(c.skipped?' / '+c.skipped+' alan otomatik atlandı':'')+(c.unreadable?' / '+c.unreadable+' görsel okunamadı':'');}pendingStatus=text;render();};
 const progress=(current,total)=>{const c=job?.kind==='page'?job.counts:null;pendingProgress={indeterminate:Boolean(c&&!c.discoveryDone),max:Math.max(1,c?.found??total),value:c?.processed??current};render();};
 async function active(){if(surface?.tab)return chrome.tabs.get(surface.tab.id);const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw Error('Manga sekmesi bulunamadı.');return tab;}
 function frameMessage(frameId,type,extra={}){return chrome.tabs.sendMessage(tabId,{type,...extra,jobOwner:lease?.owner},{frameId:frameId??0});}
 async function send(type,extra={},item=assets.get(activeId)){
  const response=await frameMessage(item?.frameId??0,type,{assetId:item?.descriptor.assetId,...extra});
  if(!response?.ok)throw Error(response?.reason||'Manga sayfasıyla bağlantı kurulamadı.');return response;
 }
 const sourcePool=new SourcePool(async(item,signal)=>{
  const token=epoch,blob=await readBlob(item,token);check(token);if(signal?.aborted)throw new DOMException('Durduruldu.','AbortError');
  const source=await loadSourceImage(blob,{signal});
  if(token!==epoch||signal?.aborted){URL.revokeObjectURL(source.url);source.image.src='';throw new DOMException('Durduruldu.','AbortError');}
  if(source.image.naturalWidth!==item.descriptor.width||source.image.naturalHeight!==item.descriptor.height){URL.revokeObjectURL(source.url);source.image.src='';throw Error('Görsel boyutu değişti.');}
  return source;
 },source=>{URL.revokeObjectURL(source.url);source.image.src='';});
 function releaseSource(){sourcePool.clear();}
 function remember(id,blob){
  const prior=blobs.get(id);if(prior)blobBytes-=prior.size;blobs.delete(id);
  if(blob.size>64*1024*1024)return;
  blobs.set(id,blob);blobBytes+=blob.size;
  while(blobBytes>64*1024*1024){const key=blobs.keys().next().value;blobBytes-=blobs.get(key).size;blobs.delete(key);}
 }
 function cached(id){const blob=blobs.get(id);if(blob){blobs.delete(id);blobs.set(id,blob);}return blob;}
 function releaseLease(){
  const held=lease;lease=undefined;if(!held)return;
  for(const frameId of held.frames)void chrome.tabs.sendMessage(held.tabId,{type:'AUTO_RELEASE_JOB',owner:held.owner},{frameId}).catch(()=>{});
 }
 async function reserve(target,token=epoch){
  if(lease?.tabId===target)return;
  releaseLease();
  const held={tabId:target,owner:panelSession+':'+token,frames:new Set([0])};
  await chrome.scripting.executeScript({target:{tabId:target},files:scripts});
  const reply=await chrome.tabs.sendMessage(target,{type:'AUTO_CLAIM_JOB',owner:held.owner},{frameId:0});
  if(!reply?.ok)throw Error(reply?.reason||'Çeviri oturumu alınamadı.');
  if(token!==epoch){void chrome.tabs.sendMessage(target,{type:'AUTO_RELEASE_JOB',owner:held.owner},{frameId:0}).catch(()=>{});check(token);}
  lease=held;
 }
 function connect(frameId){
  if(ports.has(frameId))return;
  const port=chrome.tabs.connect(tabId,{name:'automatic-session:'+lease.owner,frameId});ports.set(frameId,port);
  port.onDisconnect.addListener(()=>{if(ports.get(frameId)!==port)return;ports.delete(frameId);if(job)stop('Manga sayfasıyla bağlantı kesildi.');});
 }
 async function inject(allFrames=false){
  await reserve(tabId);
  let frameIds=[0];
  if(allFrames){const frames=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:()=>/^https?:$/.test(location.protocol)});frameIds=frames.filter(entry=>entry.result).map(entry=>entry.frameId);}
  const result=await chrome.scripting.executeScript({target:{tabId,frameIds},files:scripts});
  for(const entry of result){
   const reply=await chrome.tabs.sendMessage(tabId,{type:'AUTO_CLAIM_JOB',owner:lease.owner},{frameId:entry.frameId});
   if(!reply?.ok)throw Error(reply?.reason||'Okuyucu çerçevesi meşgul.');
   lease.frames.add(entry.frameId);layoutSessions.delete(entry.frameId);connect(entry.frameId);
  }return [...new Set(result.map(r=>r.frameId))];
 }
 function buttons(){
  const item=assets.get(activeId),selected=item?.regions.filter(r=>r.selected)??[];
  const busy=Boolean(job&&(!job.counts?.waiting||job.manualBusy));
  ui.pageTranslateButton.disabled=Boolean(job)||Boolean(surface&&!surface.ready);ui.pageStopButton.disabled=!job;ui.pageOriginalButton.disabled=!assets.size;
  ui.autoTranslateButton.disabled=!all().some(r=>r.selected)||busy;
  ui.autoStopButton.disabled=!job;ui.autoAddButton.disabled=!item||Boolean(job);
  ui.autoMergeButton.disabled=selected.length<2||Boolean(job);ui.autoSplitButton.disabled=selected.length!==1||Boolean(job);
  ui.autoOriginalButton.disabled=!assets.size;ui.autoBoxesButton.disabled=!assets.size||busy;
  ui.autoFindButton.disabled=false;ui.autoImageSelect.disabled=busy&&job?.stage!=='streaming';
 }
 let renderTimer,lastRender=0;
 function render(force=false){
  if(!force&&job&&performance.now()-lastRender<150){renderTimer??=setTimeout(()=>{renderTimer=undefined;render(true);},150-(performance.now()-lastRender));return;}
  clearTimeout(renderTimer);renderTimer=undefined;lastRender=performance.now();
  if(pendingStatus!==undefined){ui.autoStatus.textContent=pendingStatus;ui.pageStatus.textContent=pendingStatus;pendingStatus=undefined;}
  if(pendingProgress){ui.pageProgress.hidden=false;ui.pageProgress.max=pendingProgress.max;if(pendingProgress.indeterminate)ui.pageProgress.removeAttribute('value');else ui.pageProgress.value=pendingProgress.value;pendingProgress=undefined;}
  ui.autoImageSelect.replaceChildren();
  for(const item of assets.values()){const option=document.createElement('option');option.value=item.descriptor.assetId;option.textContent=item.index+'. görsel · '+item.regions.length+' alan'+(item.error?' · okunamadı':'');ui.autoImageSelect.append(option);}
  ui.autoImageSelect.value=activeId||'';ui.autoImageSelect.hidden=assets.size<2;
  const regions=assets.get(activeId)?.regions??[],every=all();
  ui.autoSummary.textContent=assets.size?assets.size+' görsel · '+every.length+' alan · '+every.filter(r=>r.selected).length+' seçili'+(every.some(r=>r.skipReason)?' · '+every.filter(r=>r.skipReason).length+' otomatik atlandı':''):'Henüz bir görsel taranmadı.';
  ui.autoRegions.replaceChildren();
  for(const r of regions){
   const row=document.createElement('div');row.className='autoRow'+(r.uncertain?' autoUncertain':'');
   const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=r.selected;checkbox.disabled=Boolean(job&&(!job.counts?.waiting||job.manualBusy));checkbox.setAttribute('aria-label',r.number+'. alanı çevir');
   checkbox.addEventListener('change',()=>{r.selected=checkbox.checked;r.automaticOverride=checkbox.checked;owner(r).edited=true;if(r.selected){delete r.skipReason;r.status='Elle seçildi; otomatik filtre aşılacak.';}render();saveEdit(owner(r));void push(owner(r)).catch(e=>status(e.message));});
   const focus=document.createElement('button');focus.className='autoRegionButton';focus.type='button';
   focus.textContent=r.number+' · '+({bubble:'Balon',text:'Yazı',free:'Çizim üstü yazı'}[r.kind]||'Yazı')+' · '+(r.manual?'Elle düzenlendi':r.uncertain?'Kontrol edilebilir':r.selected?'Seçili':'Seçili değil');
   focus.disabled=Boolean(job&&job.kind!=='translation'&&job.stage!=='translation'&&!(job.stage==='streaming'&&r.ocr));
   focus.addEventListener('click',()=>void focusRegion(r.id));
   const kind=document.createElement('select');kind.disabled=Boolean(job);kind.setAttribute('aria-label',r.number+'. alanın gösterimi');
   for(const [value,label]of [['bubble','Balon içine'],['free','Özgün yazı alanı']]){const option=document.createElement('option');option.value=value;option.textContent=label;kind.append(option);}
   kind.value=(r.displayOverride??(r.displayGeometry?.mode==='inside'?'bubble':r.kind))==='free'?'free':'bubble';
   kind.addEventListener('change',()=>{owner(r).edited=true;r.kind=kind.value;r.displayOverride=kind.value;if(r.record)r.record.automatic.kind=r.kind;r.editRevision++;saveEdit(owner(r));void hide(r);void push(owner(r)).catch(e=>status(e.message));});
   const remove=document.createElement('button');remove.textContent='Sil';remove.disabled=Boolean(job);
   remove.addEventListener('click',()=>{void hide(r);const item=owner(r);item.edited=true;item.regions=item.regions.filter(a=>a!==r);callbacks.onInvalidated?.(r.id);render();saveEdit(item);void push(item).catch(e=>status(e.message));});
   const info=document.createElement('small');info.textContent=r.status||'Çeviri için hazır.';
   row.append(checkbox,focus,kind,remove,info);ui.autoRegions.append(row);
  }
  buttons();surface?.refresh({busy:Boolean(job),waiting:Boolean(job?.counts?.waiting),found:assets.size,ready:job?.counts?.ready??assets.size,shown:every.filter(r=>r.record?.overlayVisible).length,failed:every.filter(r=>r.failureEpoch===epoch).length});
 }
 async function push(item){
  return send('AUTO_SET_REGIONS',{visible:editor,regions:item.regions.map(({id,number,bounds,kind,score,selected,uncertain,revision,editRevision,bubbleBounds,manual,displayGeometry,displayOverride,automaticOverride,textStyle,drawingEdits})=>({id,number,bounds,kind,score,selected,uncertain,revision,editRevision,bubbleBounds,manual,displayGeometry,displayOverride,automaticOverride,textStyle,drawingEdits}))},item);
 }
 async function hide(r){try{await frameMessage(owner(r)?.frameId,'HIDE_TRANSLATION',{selectionId:r.id});}catch{}}
 function cancelCollection(){for(const frameId of ports.keys())void frameMessage(frameId,'PAGE_CANCEL_COLLECTION').catch(()=>{});}
 function stashEdits(){
  for(const item of assets.values())if(item.sourceHash&&(item.edited||item.regions.some(r=>r.record?.confirmed))){
   const regions=item.regions.map(r=>{
    const clone={...r,ocrPromise:undefined,crop:r.crop?{...r.crop}:undefined,record:r.record?{...r.record}:undefined};
    if(clone.crop)delete clone.crop.imageDataUrl;if(clone.record)delete clone.record.imageDataUrl;
    return clone;
   });
   editCache.set(item.descriptor.imageUrl,{...item,edited:true,regions});
   while(editCache.size>100)editCache.delete(editCache.keys().next().value);
   saveEdit(item);
  }
 }
 function stop(message='İşlem durduruldu. Tamamlanan çeviriler sayfada kaldı.',keepLease=false){
  for(const frameId of ports.keys())void frameMessage(frameId,'AUTO_CANCEL_LAYOUT_SESSION',{layoutSession:layoutSession(epoch)}).catch(()=>{});
  layoutSessions.clear();stashEdits();epoch++;focusSerial++;job?.abort.abort();stopInpainting();job=undefined;stopDetection();cancelCollection();releaseSource();pendingProgress=undefined;ui.pageProgress.hidden=true;if(!keepLease)releaseLease();render(true);status(message);
 }
 async function clear(keepLease=false){
  stop('Sayfa hazırlanıyor…',keepLease);
  const frames=[...ports.keys()];
  if(!keepLease||lease?.tabId!==tabId){for(const port of ports.values())port.disconnect();ports.clear();}
  if(tabId)await Promise.allSettled(frames.map(frameId=>frameMessage(frameId,'AUTO_PAGE_CLEAR')));
  releaseSource();assets.clear();blobs.clear();blobBytes=0;activeId=undefined;focusId=undefined;missingOrigins.clear();incompleteChapter=false;
  callbacks.onInvalidated?.();ui.autoPermissionButton.hidden=true;render();
 }
 async function readBlob(item,token){
  check(token);const present=cached(item.descriptor.assetId);if(present)return present;
  const type=item.descriptor.pageManaged?'PAGE_READ_ASSET':'AUTO_READ_IMAGE';
  const result=await frameMessage(item.frameId,type,{assetId:item.descriptor.assetId,asset:item.descriptor});check(token);
  let blob;
  if(result?.dataUrl)blob=await globalThis.__mangaReadBoundedBlob(await fetch(result.dataUrl));
  else{
   if(!result?.needsOrigin)throw Error(result?.reason||'Görsel okunamadı.');
   const url=new URL(item.descriptor.imageUrl),origin=url.origin+'/*';
   if(!await chrome.permissions.contains({origins:[origin]})){missingOrigins.add(origin);ui.autoPermissionButton.hidden=false;throw Error('Görsel erişimi gerekiyor: '+url.hostname);}
   let last;
   for(let attempt=0;attempt<2;attempt++){
    check(token);
    try{const response=await fetch(url.href,{credentials:attempt?'include':'omit',redirect:'error',cache:'force-cache',signal:job?AbortSignal.any([job.abort.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});if(!response.ok){await response.body?.cancel();throw Error('Görsel sunucusu: '+response.status);}blob=await globalThis.__mangaReadBoundedBlob(response);break;}
    catch(error){last=error;if(error.name==='AbortError'||error.name==='QuotaExceededError')throw error;}
   }
   if(!blob)throw last;
  }
  check(token);if(blob.size>80_000_000)throw Error('Görsel dosyası çok büyük.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');check(token);
  if(item.sourceHash&&item.sourceHash!==hash)throw Error('Görsel taramadan sonra değişti; yeniden tara.');
  item.sourceHash=hash;remember(item.descriptor.assetId,blob);return blob;
 }
 async function useSource(item,token,options={}){
  check(token);return sourcePool.acquire(item,{signal:options.signal??job?.abort.signal,priority:options.priority??0});
 }
 async function readOcr(r,token,options={}){
  const item=owner(r),revision=r.revision,editRevision=r.editRevision||0;
  if(r.ocr&&r.crop?.imageDataUrl)return r;
  const signal=options.signal??job?.abort.signal;
  let lease,crop;
  try{
  if(!options.source)lease=await useSource(item,token,options);check(token);
  const source=options.source??lease.source;
  crop=await cropSourceImage(source.image,r.bounds,{analyzeLayout:globalThis.__mangaFeatures.paddleFastBlock,signal,sessionId:job?.sessionId,priority:options.priority??0});
  check(token);
  let ocr=r.ocr;
  if(!ocr)try{ocr=await recognize(crop.imageDataUrl,settingsFor(item).sourceLanguage,{layout:crop.ocrLayout,ocrInput:crop.ocrInput,sessionId:job?.sessionId,signal,priority:options.priority??0});}
  catch(error){if(error.name==='AbortError')throw error;check(token);ocr={text:'',confidence:0,lines:[],lowConfidenceWords:[],modelVersion:'unknown',error:error.message};}
  check(token);if(find(r.id)!==r||revision!==r.revision)throw new DOMException('Alan değişti.','AbortError');
  if(editRevision!==(r.editRevision||0))throw Error('Metin düzenlendi; geç OCR sonucu uygulanmadı.');
  delete crop.ocrInput;
  r.crop=crop;r.ocr=ocr;r.english??=ocr.text;r.turkish??='';r.readState=ocr.text?.trim()?'read':'failed';
  r.record={...r.record,id:r.record?.id??crypto.randomUUID(),tabId,selectionId:r.id,pageKey:item.descriptor.pageKey||item.descriptor.pageUrl+'::'+item.descriptor.imageUrl,...crop,ocr,
   sourceLanguage:settingsFor(item).sourceLanguage,targetLanguage:settingsFor(item).targetLanguage,confirmed:r.record?.confirmed??false,autoRegionId:r.id,autoAssetId:item.descriptor.assetId,
   automatic:{sourceImageUrl:/^(data|blob|canvas):/.test(item.descriptor.imageUrl)?null:item.descriptor.imageUrl,sourceImageSha256:item.sourceHash,
    nativeImageWidth:item.descriptor.width,nativeImageHeight:item.descriptor.height,nativeBounds:{...r.bounds},kind:r.kind,detector:item.detector,detectionScore:r.manual?null:r.score,manuallyAdjusted:Boolean(r.manual),refinement:r.refinement??null}};
  r.status=ocr.error?'OCR çalışmadı: '+ocr.error:ocr.text?'Okundu · OCR %'+Math.round(ocr.confidence):'Metin okunamadı.';
  return r;
  }finally{lease?.release();}
 }
 async function ensureOcr(r,token,options={}){
  if(r.ocr&&r.crop?.imageDataUrl)return r;
  if(r.ocrPromise?.token===token)return r.ocrPromise.promise;
  const promise=readOcr(r,token,options),pending={token,promise};r.ocrPromise=pending;
  try{return await promise;}finally{if(r.ocrPromise===pending)r.ocrPromise=undefined;}
 }
 async function focusRegion(id){
  const r=find(id);if(!r)return;const token=epoch,serial=++focusSerial;activeId=r.assetId;focusId=id;render();
  try{await send('AUTO_FOCUS',{regionId:id},owner(r));await ensureOcr(r,token);check(token);if(serial!==focusSerial)return;callbacks.onFocus(r.record,r.english||'',r.turkish||'');render();status(r.number+'. alan mevcut metin düzenleme bölümünde açıldı.');}
  catch(error){if(error.name!=='AbortError')status('Alan açılamadı: '+error.message);}
 }
 async function showRegion(r,text=r.turkish,token=epoch){
  check(token);const item=owner(r),editRevision=r.editRevision||0;await prepareLayout(item.frameId??0,token);check(token);
  if(editRevision!==(r.editRevision||0))throw new DOMException('Metin düzenlendi; eski gösterim uygulanmadı.','AbortError');
  if(!r.crop||!text?.trim())throw Error('Türkçe çeviri boş.');
  await ensureOcr(r,token);await prepareRegion(r,r.crop,{signal:job?.abort.signal});check(token);
  if(editRevision!==(r.editRevision||0))throw new DOMException('Metin düzenlendi; eski temizleme uygulanmadı.','AbortError');
  const result=await send('AUTO_SHOW_TRANSLATION',{layoutSession:layoutSession(token),imageNumber:item.index,selectionId:r.id,text,cleanupPatch:r.cleanupPatch,appearance:r.appearance,erasePolygons:r.ocr.lines.flatMap(l=>[l,...(l.words??[])].map(w=>w.polygon).filter(Boolean)),flat:r.kind!=='free'&&r.crop.background.flatForAutomatic===true,revision:r.revision||0,editRevision,displayGeometry:r.displayGeometry,displayOverride:r.displayOverride,ocrBounds:r.crop.sourceBounds,
   background:r.crop.background.color,textColor:r.crop.background.textColor,direction:getTargetLanguage(settingsFor(item).targetLanguage).direction,textStyle:r.textStyle??settingsFor(item).textStyle,drawingEdits:r.drawingEdits??[],eraseBoxes:r.ocr.lines.map(l=>l.bbox).filter(Boolean),imageWidth:r.crop.width,imageHeight:r.crop.height},owner(r));
  check(token);if(find(r.id)!==r||editRevision!==(r.editRevision||0))throw new DOMException('Alan düzenlendi; geç gösterim sonucu uygulanmadı.','AbortError');
  delete r.failureStage;delete r.failureEpoch;r.displayState=result.state||'ready';r.displaySession=layoutSession(token);r.displayMode=result.mode;
  r.status=result.state==='waiting-for-image'?'Çeviri hazır; görselin okuyucuya dönmesi bekleniyor.':'Özgün konumunda gösteriliyor.';
  if(result.fallbackReason)r.status+=' '+result.fallbackReason;
  r.record.overlayVisible=true;r.record.displayState=r.displayState;return result;
 }
 function releaseCrops(item){
  for(const r of item.regions)if(r.id!==focusId&&r.crop){delete r.crop.imageDataUrl;if(r.record)delete r.record.imageDataUrl;}
 }
 async function processRegions(item,selected,token,preparing,onCount=()=>{}){
  let preparationError;const preparation=Promise.resolve(preparing).catch(error=>{preparationError=error;});
  const signal=job?.abort.signal,sessionId=job?.sessionId;check(token);
  const lease=await useSource(item,token,{signal,priority:1});
  let cursor=0,inFlight=0,shown=0,failed=0,skipped=0,fatal;
  const priority=job?.kind==='page'?1:0;
  const pending=new Set(),tasks=[];
  async function finish(r){
   let stage='ocr';
   try{
     const eligibility=automaticEligibility(r,settingsFor(item).sourceLanguage);
    if(!eligibility.eligible){
     r.skipReason=eligibility.reason;r.selected=false;r.readState='skipped';
     r.status='Otomatik atlandı: '+(eligibility.reason==='no-latin'?'Latin harfi bulunamadı.':eligibility.reason==='source-script'?'Seçilen kaynak dile uygun harf bulunamadı.':'Dikey efekt biçimi, parçalı harfler ve düşük OCR güveni birlikte bulundu.')+' Elle seçebilir veya metni düzeltebilirsin.';
     skipped++;onCount(0,0,1);await push(item);return;
    }
    delete r.skipReason;
    await withSignal(preparation,signal);check(token);
    if(!r.english?.trim()&&!r.turkish?.trim())throw Error(r.ocr?.error?'OCR çalışmadı: '+r.ocr.error:'OCR metin okuyamadı.');
    stage='translation';if(preparationError&&!r.turkish?.trim())throw Error('Çeviri modeli hazırlanamadı: '+preparationError.message);
    const english=r.english,revision=r.editRevision;
    const s=settingsFor(item),result=r.turkish?.trim()||await translate(english,s.sourceLanguage,s.targetLanguage,()=>{},{signal,sessionId,priority,termMemory:getTermMemory(s)});check(token);
    if(r.english!==english||r.editRevision!==revision){r.status='Metin değişti; düzeltmen korundu.';failed++;onCount(0,1);return;}
    if(!result?.trim())throw Error('Çeviri boş döndü.');
    r.turkish=result;r.translationState='translated';stage='display';await showRegion(r,r.turkish,token);check(token);shown++;onCount(1,0);callbacks.onText?.(r.id,r.english,r.turkish,r.assetId);
   }catch(error){if(error.name==='AbortError'){fatal=error;return;}r.failureStage=stage;r.failureEpoch=token;if(stage==='display'){r.displayState='failed';r.status='Çeviri hazır; gösterilemedi: '+error.message;}else{if(stage==='translation')r.translationState='failed';r.status='Çevrilemedi: '+error.message;}failed++;onCount(0,1);}
   finally{if(r.id!==focusId&&r.crop){delete r.crop.imageDataUrl;if(r.record)delete r.record.imageDataUrl;}render();}
  }
  async function lane(){
   while(cursor<selected.length){
    check(token);if(fatal)throw fatal;
    while(pending.size+inFlight>=4){await Promise.race(pending);check(token);if(fatal)throw fatal;}
    if(cursor>=selected.length)return;
    const r=selected[cursor++];inFlight++;
    try{await send('AUTO_CHECK_IMAGE',{},item);check(token);await ensureOcr(r,token,{source:lease.source,signal,priority});check(token);}
    catch(error){if(error.name==='AbortError')throw error;r.status='Çevrilemedi: '+error.message;failed++;onCount(0,1);render();continue;}
    finally{inFlight--;}
    const task=finish(r);pending.add(task);tasks.push(task);void task.then(()=>pending.delete(task));
   }
  }
  try{
   const lanes=await Promise.allSettled(Array.from({length:Math.min(resourcePolicy().ocrWorkers,Math.max(1,selected.length))},lane));
   await Promise.all(tasks);
    const rejected=lanes.find(result=>result.status==='rejected');if(rejected)throw rejected.reason;check(token);if(fatal)throw fatal;return {shown,failed,skipped};
   }finally{lease.release();releaseCrops(item);await persist(item,item.edited===true);}
 }
 async function translateRegions(selected,token,preparing,onCount=()=>{}){
  let shown=0,failed=0,skipped=0;const grouped=new Map();
  for(const r of selected){if(!grouped.has(r.assetId))grouped.set(r.assetId,[]);grouped.get(r.assetId).push(r);}
  for(const [assetId,regions]of grouped){
   check(token);const item=assets.get(assetId);if(!focusId)activeId=assetId;
   status('Kaynak metin okunuyor ve çevriliyor.');render();
   const result=await processRegions(item,regions,token,preparing,onCount);shown+=result.shown;failed+=result.failed;skipped+=result.skipped;
  }
  progress(selected.length,selected.length);return {shown,failed,skipped};
 }
 
 async function scan(item,token,saved){
  const blob=await readBlob(item,token);check(token);
  const key=await readingKey(item),stored=await loadReading(key);check(token);
  if(stored?.sourceHash===item.sourceHash){saved=stored;item.detector=stored.detector;item.edited=stored.edited;}
  else{
   const result=await detectImage(blob,p=>{if(token===epoch)status(item.index+'. görsel: '+p.message);},{keepAlive:true});check(token);
   item.descriptor.width=result.width;item.descriptor.height=result.height;item.detector=result.detector;
   item.regions=result.regions.map(r=>({...r,id:item.descriptor.assetId+':'+r.id,assetId:item.descriptor.assetId,selected:Boolean(r.selected&&!r.fallback),revision:0,editRevision:0}));
  }
  if(saved?.sourceHash===item.sourceHash&&(saved.readingKey??saved.key)===key&&Array.isArray(saved.regions)){
   item.edited=Boolean(saved.edited);
   item.regions=saved.regions.map((r,i)=>{
    const next={...r,id:item.descriptor.assetId+':saved-'+i,assetId:item.descriptor.assetId,revision:Number.isSafeInteger(r.revision)&&r.revision>=0?r.revision:0,editRevision:Number.isSafeInteger(r.editRevision)&&r.editRevision>=0?r.editRevision:0,ocrPromise:undefined,displaySession:undefined};
    if(next.record)next.record={...next.record,autoAssetId:item.descriptor.assetId,overlayVisible:false,overlayWantsRefresh:false};
    return next;
   });
  }
  if(item.descriptor.pageManaged)await send('AUTO_PAGE_REGISTER',{asset:{...item.descriptor,displayIndex:item.index}},item);
  await push(item);check(token);delete item.error;render();
 }
 async function preflight(){
  if(job)return;
  try{
   const tab=await active();if(!/^https?:/.test(tab.url||''))return;
   if(tabId&&tabId!==tab.id)preview=undefined;
   const target=tab.id;
   await chrome.scripting.executeScript({target:{tabId:target},files:scripts});
   const result=await chrome.tabs.sendMessage(target,{type:'PAGE_PREVIEW'},{frameId:0});
   if(!result?.ok)return;
   const rootOrigin=new URL(tab.url).origin+'/*',required=[];
   for(const origin of result.origins)if(origin!==rootOrigin&&!await chrome.permissions.contains({origins:[origin]}))required.push(origin);
   preview={...result,tabId:target,required};buttons();
  }catch{} // The toolbar grants activeTab; a later click can prepare the same page.
 }
 function reorderAssets(){
  const ordered=[...assets.values()].sort((a,b)=>(job?.frameOrder.get(a.frameId)??a.frameId)-(job?.frameOrder.get(b.frameId)??b.frameId)||(a.descriptor.index??a.index)-(b.descriptor.index??b.index));
  ordered.forEach((item,i)=>{const changed=item.index!==i+1;item.index=i+1;if(changed&&item.regions.length)void frameMessage(item.frameId,'AUTO_PAGE_NUMBER',{assetId:item.descriptor.assetId,imageNumber:item.index}).catch(()=>{});});
 }
 function addAssets(descriptors,frameId,token){
  check(token);if(!job?.pipeline)return;
  for(const descriptor of descriptors){
   const existing=[...assets.values()].find(a=>a.descriptor.imageUrl===descriptor.imageUrl);
   if(existing){if(descriptor.nodeId)existing.descriptor.nodeId=descriptor.nodeId;if(descriptor.index)existing.descriptor.index=descriptor.index;continue;}
   const item={descriptor,frameId,index:assets.size+1,regions:[]};assets.set(descriptor.assetId,item);job.pipeline.add(item);
   if(!activeId||job.visible.get(frameId)?.has(descriptor.imageUrl))if(!focusId)activeId=descriptor.assetId;
  }
  reorderAssets();job.pipeline.update();render();
 }
 function comparePriority(a,b){
  const visible=[...assets.values()].filter(i=>(i.frameId===0||job?.visibleFrames?.has(job.frameUrls?.get(i.frameId)))&&job?.visible.get(i.frameId)?.has(i.descriptor.imageUrl));
  const ahead=new Set();
  for(const item of visible)for(const next of [...assets.values()].filter(i=>i.index>item.index).sort((x,y)=>x.index-y.index).slice(0,2))ahead.add(next.descriptor.assetId);
  const rank=item=>visible.includes(item)?0:ahead.has(item.descriptor.assetId)?1:2;
  return rank(a)-rank(b)||a.index-b.index;
 }
 async function collectAssets(token){
  const current=job;let frames=[0];current.frameKeys=new Map([[0,preview.pageUrl]]);current.frameOrder=new Map([[0,0]]);current.frameUrls=new Map();
  if(preview?.frames.length){
   const injected=await inject(true);check(token);
   for(const frameId of injected)if(frameId!==0)try{
    const info=await frameMessage(frameId,'PAGE_PREVIEW');check(token);
    if(info?.ok&&preview.frames.some(url=>url.split('#')[0]===info.readerUrl||url.split('#')[0]===info.pageUrl)){
     current.frameKeys.set(frameId,info.pageUrl);current.frameUrls.set(frameId,info.readerUrl);current.frameOrder.set(frameId,frames.length);frames.push(frameId);
    }
   }catch(error){if(error.name==='AbortError')throw error;}
  }else await inject();
  let incomplete=false;current.discovery=[];current.collecting=true;
  for(const frameId of frames){
   check(token);status('Bölüm görselleri bulunuyor ve çeviri başlıyor.');
   const result=await frameMessage(frameId,'PAGE_COLLECT',{sessionId:current.sessionId});check(token);
   if(!result?.ok){if(!assets.size)throw Error(result?.reason||'Bölüm görselleri toplanamadı.');incomplete=true;current.warnings=(current.warnings??0)+1;updateDiscovery(frameId,{complete:true,failed:true,reason:result?.reason||'Bölüm görselleri toplanamadı.'});continue;}
   addAssets(result.assets,frameId,token);incomplete ||= Boolean(result.incomplete);
   updateDiscovery(frameId,result.discovery);
  }
  if(!assets.size)throw Error('Bu sayfada okunabilir manga görseli bulunamadı.');
  current.collecting=false;
  return {incomplete,discoveryDone:current.discovery.length===frames.length&&current.discovery.every(d=>d.complete)};
 }
 function updateDiscovery(frameId,discovery){
  if(!job?.pipeline||!discovery)return;
  job.discovery??=[];job.discovery=job.discovery.filter(d=>d.frameId!==frameId);job.discovery.push({frameId,...discovery});
  if(!job.collecting&&!job.manualBusy&&job.discovery.length===job.frameKeys.size&&job.discovery.every(d=>d.complete))job.pipeline.finishDiscovery(Boolean(job.warnings));
 }
 async function prepareOrigins(items,token){
  const rootOrigin=new URL(items[0]?.descriptor.pageUrl||preview?.pageUrl).origin+'/*',required=new Set();
  for(const item of items)if(/^https?:/.test(item.descriptor.imageUrl)){
   const origin=new URL(item.descriptor.imageUrl).origin+'/*';
   if(origin!==rootOrigin&&!await chrome.permissions.contains({origins:[origin]}))required.add(origin);
  }
  check(token);if(!required.size)return;
  for(const origin of required)missingOrigins.add(origin);
  ui.autoPermissionButton.hidden=false;ui.autoPermissionButton.textContent='Yeni görsel sunucularına izin ver';
  status('Yeni bulunan görsel sunucuları için Chrome erişim izni gerekiyor. İzin verince işlem kendiliğinden devam edecek.');
  await new Promise((resolve,reject)=>{
   job.permission={resolve,reject};
   job.abort.signal.addEventListener('abort',()=>reject(new DOMException('Durduruldu.','AbortError')),{once:true});
  });check(token);
 }
 function translatorInGesture(token){
   const s=getProductSettings(),preparing=prepareTranslator(s.sourceLanguage,s.targetLanguage,percent=>{if(job?.token===token)status('Yerel dil paketi hazırlanıyor: %'+percent);});
  preparing.catch(()=>{});return preparing;
 }
 function pageClick(requestedTab){
  if(job)return;
  // Both APIs are called in the first button gesture, before any awaited scan.
  const futureToken=epoch+1;let preparing,request;
  try{
   preparing=translatorInGesture(futureToken);
   request=preview?.required.length&&(!requestedTab||preview.tabId===requestedTab.id)?chrome.permissions.request({origins:preview.required}):Promise.resolve(true);
  }catch(error){status('Başlatılamadı: '+error.message);return;}
  stashEdits();const saved=new Map(editCache);const startingToken=epoch;
  job={kind:'starting',token:epoch,abort:new AbortController()};buttons();
  void (async()=>{
   const tab=requestedTab??await active();check(startingToken);
   await reserve(tab.id,startingToken);check(startingToken);
   await clear(true);const token=startingToken+1;check(token);tabId=tab.id;editor=false;ui.autoBoxesButton.textContent='Kutuları göster';
   job={kind:'page',token,abort:new AbortController()};incompleteChapter=true;render();
   try{
    if(!await request)throw Error('Chrome görsel erişimine izin vermedi. Sayfayı çevir düğmesiyle yeniden deneyebilirsin.');
    check(token);
    {
     await inject();const info=await frameMessage(0,'PAGE_PREVIEW');check(token);preview={...info,tabId,required:[]};
    }
     const current=job;current.sessionId=crypto.randomUUID();current.stage='streaming';current.visible=new Map();current.frameOrder=new Map();current.frameKeys=new Map();current.collecting=true;
     const warming=prepareDetection();warming.catch(()=>{});const ocrReady=prepareOcr(getProductSettings().sourceLanguage,{signal:current.abort.signal,sessionId:current.sessionId,priority:1});ocrReady.catch(()=>{});
    current.pipeline=new ReadingPipeline({
     signal:current.abort.signal,priority:comparePriority,
      scan:async item=>{check(token);await warming;await prepareOrigins([item],token);check(token);await scan(item,token,saved.get(item.descriptor.imageUrl));},
     process:async(item,onCount)=>{check(token);await ocrReady;return processRegions(item,item.regions.filter(r=>r.selected),token,preparing,onCount);},
      onUpdate:counts=>{if(job!==current||epoch!==token)return;current.counts=counts;incompleteChapter=!counts.discoveryDone||counts.incomplete||counts.processed<counts.found;progress(counts.processed,counts.found);if(counts.waiting&&!current.collecting){stopDetection();status('Bulunan görseller işlendi. Bölümün tam listesi doğrulanamadı; yeni görseller bekleniyor.'+(current.warningMessage?' Bazı bölüm kaynakları arka planda alınamadı: '+current.warningMessage:''));}else status('Tarama ve çeviri sürüyor.');render();},
    });
    const result=await current.pipeline.run(()=>collectAssets(token));check(token);
    incompleteChapter ||= Boolean(result.incomplete||current.warnings);
    stopDetection();
    const detail=all().find(r=>r.status?.startsWith('Çevrilemedi:'))?.status||[...assets.values()].find(a=>a.error)?.error;
    const discovery=current.discovery??[],listed=discovery.length===1&&Number.isInteger(discovery[0].expectedCount),coverage=listed?' Beklenen '+discovery[0].expectedCount+' / bulunan '+discovery[0].foundCount+' görsel.':' Bölümün tam sayfa listesi doğrulanamadı; bulunan görseller işlendi.';
    const displayFailed=all().filter(r=>r.failureEpoch===token&&r.failureStage==='display').length,waiting=all().filter(r=>r.record?.overlayVisible&&r.displayState==='waiting-for-image').length;
     status(assets.size+' görsel bulundu; '+result.ready+' görsel işlendi; '+result.shown+' çeviri gösteriliyor. '+(result.failed-displayFailed)+' alan çevrilemedi'+(result.skipped?', '+result.skipped+' alan otomatik atlandı':'')+(displayFailed?', '+displayFailed+' hazır çeviri gösterilemedi':'')+(waiting?', '+waiting+' çeviri görselin dönmesini bekliyor':'')+(result.unreadable?', '+result.unreadable+' görsel okunamadı':'')+(current.warnings?', '+current.warnings+' bölüm sayfası alınamadı':'')+(result.incomplete?'. Bölüm işlemi eksik kaldı':'')+'.'+coverage+' Otomatik sonuçlar eğitim kaydı oluşturmaz.'+(detail?' · '+detail:''));
   }catch(error){if(error.name!=='AbortError')status('İşlem tamamlanamadı: '+error.message);}
   finally{if(job?.token===token){job.abort.abort();job=undefined;releaseSource();stopDetection();cancelCollection();releaseLease();render(true);}}
  })().catch(error=>{if(job?.kind==='starting'){job=undefined;releaseLease();render();}if(error.name!=='AbortError')status('Başlatılamadı: '+error.message);});
 }
 async function pick(){
  const tab=await active();await reserve(tab.id);await clear(true);tabId=tab.id;editor=true;ui.autoBoxesButton.textContent='Kutuları gizle';
  try{await inject();await send('AUTO_PICK_IMAGE');status('Manga sayfasında taranacak görsele bir kez tıkla. Esc: iptal.');}
  catch(error){releaseLease();status('Görsel seçimi başlatılamadı: '+error.message);}
 }
 async function selectedImage(message,sender){
  stop('Tam görsel okunuyor.',true);const token=epoch;
  const item={descriptor:message.image,frameId:sender.frameId??0,index:1,regions:[]};
  assets.set(item.descriptor.assetId,item);activeId=item.descriptor.assetId;
  job={kind:'detection',token,abort:new AbortController()};render();
  try{await scan(item,token);status(item.regions.length?'Kutular hazır. Metinleri düzeltebilir veya seçilenleri çevirebilirsin.':'Yazı bulunamadı; eksik alan ekleyebilirsin.');}
  catch(error){if(error.name!=='AbortError')status('Tarama yapılamadı: '+error.message);}
  finally{if(job?.token===token){job=undefined;releaseLease();stopDetection();render();}}
 }
 function permissionClick(){
  if(!missingOrigins.size)return;
  const token=epoch,request=chrome.permissions.request({origins:[...missingOrigins]});
  void (async()=>{
   if(!await request){status('Görsel erişimi verilmedi. Chrome izni gerekiyor.');job?.permission?.reject(Error('Görsel erişimi verilmedi.'));return;}
   check(token);missingOrigins.clear();ui.autoPermissionButton.hidden=true;
   if(job?.permission){job.permission.resolve();job.permission=undefined;return;}
   const item=assets.get(activeId);if(!item)return;
   job={kind:'detection',token,abort:new AbortController()};render();
   try{await reserve(tabId,token);await scan(item,token);status('Görsel tarandı. Seçilenleri çevirebilirsin.');}
   finally{if(job?.token===token){job=undefined;releaseLease();stopDetection();render();}}
  })().catch(error=>{if(error.name!=='AbortError')status(error.message);});
 }
 function batchClick(){
  if(!all().some(r=>r.selected)||job&&!(job.kind==='page'&&job.counts?.waiting&&!job.manualBusy))return;
  const token=epoch;let preparing;
  try{preparing=translatorInGesture(token);}catch(error){status(error.message);return;}
  if(job?.kind==='page'){
   const current=job;current.manualBusy=true;render();
   void translateRegions(all().filter(r=>r.selected&&(!r.record?.overlayVisible||r.sourceCorrected)),token,preparing,(...counts)=>current.pipeline.count(...counts))
    .catch(error=>{if(error.name!=='AbortError')status('Çeviri tamamlanamadı: '+error.message);})
    .finally(()=>{if(job===current){current.manualBusy=false;const evidence=current.discovery?.[0];if(evidence)updateDiscovery(evidence.frameId,evidence);current.pipeline.update();render();}});
   return;
  }
  job={kind:'translation',token,abort:new AbortController()};render();
  void reserve(tabId,token).then(()=>translateRegions(all().filter(r=>r.selected),token,preparing)).then(result=>{
   check(token);status(result.shown+' çeviri sayfada gösteriliyor. '+result.failed+' alan çevrilemedi; '+result.skipped+' alan otomatik atlandı. Otomatik sonuçlar eğitim kaydı oluşturmaz.');
  }).catch(error=>{if(error.name!=='AbortError')status('Çeviri tamamlanamadı: '+error.message);})
   .finally(()=>{if(job?.token===token){job=undefined;releaseLease();releaseSource();render();}});
 }
 function geometryChanged(item,incoming){
  const prior=new Map(item.regions.map(r=>[r.id,r]));item.edited=true;
  item.regions=incoming.map(r=>{
   const old=prior.get(r.id);
   if(old&&old.revision===r.revision){
    const next={...old,...r,assetId:item.descriptor.assetId};
    if(old.selected!==r.selected&&next.record)next.record={...next.record,overlayVisible:false};
    if(next.automaticOverride&&next.selected){delete next.skipReason;next.status='Elle seçildi; otomatik filtre aşılacak.';}
    return next;
   }
   callbacks.onInvalidated?.(r.id);return {...r,assetId:item.descriptor.assetId,editRevision:0};
  });
  for(const id of prior.keys())if(!item.regions.some(r=>r.id===id))callbacks.onInvalidated?.(id);
  saveEdit(item);render();
 }
 async function merge(){
  const item=assets.get(activeId),chosen=item?.regions.filter(r=>r.selected)??[];if(chosen.length<2)return;
  stop('Seçili alanlar birleştiriliyor.');item.edited=true;
  const bounds=clampBounds(unionBounds(chosen.map(r=>r.bounds)),item.descriptor.width,item.descriptor.height);
  for(const r of chosen){await hide(r);callbacks.onInvalidated?.(r.id);}
  const number=Math.min(...chosen.map(r=>r.number));item.regions=item.regions.filter(r=>!chosen.includes(r));
  item.regions.push({id:crypto.randomUUID(),assetId:item.descriptor.assetId,number,bounds,kind:chosen.every(r=>r.kind!=='free')?'text':'free',score:1,manual:true,selected:true,uncertain:false,revision:0,editRevision:0});
  item.regions.sort((a,b)=>a.number-b.number);await push(item);await persist(item,true);render();status('Alanlar birleştirildi.');
 }
 async function split(){
  const item=assets.get(activeId),selected=item?.regions.filter(r=>r.selected)??[];if(selected.length!==1)return;
  const r=selected[0],b=r.bounds;item.edited=true;
  await hide(r);callbacks.onInvalidated?.(r.id);item.regions=item.regions.filter(x=>x!==r);
  const next=Math.max(r.number,...item.regions.map(x=>x.number))+1;
  for(let n=0;n<2;n++)item.regions.push({id:crypto.randomUUID(),assetId:item.descriptor.assetId,number:n?next:r.number,bounds:{...b,y:b.y+n*b.height/2,height:b.height/2},kind:r.kind,score:1,manual:true,selected:true,uncertain:false,revision:0,editRevision:0});
  await push(item);await persist(item,true);render();status('Alan ikiye bölündü. Kutuları sürükleyerek sınırlarını düzeltebilirsin.');
 }
 async function restorePage(){
  if(job)return;const token=epoch;const checkRestore=()=>{check(token);if(job)throw new DOMException('Yeni işlem başladı.','AbortError');};
  try{
  await inject();checkRestore();
  const rootInfo=await frameMessage(0,'PAGE_PREVIEW');checkRestore();
  if(!rootInfo?.ok)return;
  const belongs=[...assets.values()].some(a=>a.descriptor.pageManaged&&a.descriptor.pageUrl===rootInfo.pageUrl);
  if(!belongs){stop('Bölüm değişti. Yeni bölümde Sayfayı çevir düğmesine basabilirsin.');void preflight();return;}
  const frames=rootInfo.frames.length?await inject(true):[0];checkRestore();
  for(const frameId of frames){
   const info=await frameMessage(frameId,'PAGE_PREVIEW');checkRestore();
   for(const item of assets.values())if(item.descriptor.pageManaged&&item.descriptor.pageUrl===info?.pageUrl){
    item.frameId=frameId;await send('AUTO_PAGE_REGISTER',{asset:{...item.descriptor,displayIndex:item.index}},item);checkRestore();await push(item);
    for(const r of item.regions)if(r.record?.overlayVisible&&r.turkish?.trim()){await showRegion(r,r.turkish,token);checkRestore();}
   }
  }
  void preflight();render();
  }finally{if(!job)releaseLease();}
 }
 async function original(){
  stop('Özgün sayfa açılıyor.');editor=false;ui.autoBoxesButton.textContent='Kutuları göster';
  await Promise.allSettled([...ports.keys()].map(frameId=>frameMessage(frameId,'AUTO_PAGE_HIDE_ALL')));
  await Promise.allSettled([...ports.keys()].map(frameId=>frameMessage(frameId,'AUTO_PAGE_EDITOR',{visible:false})));
  for(const r of all())if(r.record){r.record.overlayVisible=false;r.record.overlayWantsRefresh=false;}
  status('Bütün çeviri katmanları kaldırıldı. Metin düzeltmelerin korundu.');
 }
 ui.pageTranslateButton.addEventListener('click',()=>pageClick());
 ui.pageStopButton.addEventListener('click',()=>stop());
 ui.pageOriginalButton.addEventListener('click',()=>void original().catch(e=>status(e.message)));
 ui.autoFindButton.addEventListener('click',()=>void pick().catch(e=>status(e.message)));
 ui.autoPermissionButton.addEventListener('click',permissionClick);
 ui.autoTranslateButton.addEventListener('click',batchClick);
 ui.autoStopButton.addEventListener('click',()=>{stop();void send('AUTO_CANCEL_PICK').catch(()=>{});});
 ui.autoAddButton.addEventListener('click',()=>void send('AUTO_ADD').then(()=>status('Eksik yazı alanını manga görselinde sürükleyerek seç. Esc: iptal.')).catch(e=>status(e.message)));
 ui.autoMergeButton.addEventListener('click',()=>void merge().catch(e=>status(e.message)));
 ui.autoSplitButton.addEventListener('click',()=>void split().catch(e=>status(e.message)));
 ui.autoOriginalButton.addEventListener('click',()=>void original().catch(e=>status(e.message)));
 ui.autoBoxesButton.addEventListener('click',()=>{
  editor=!editor;ui.autoBoxesButton.textContent=editor?'Kutuları gizle':'Kutuları göster';
  for(const frameId of ports.keys())void frameMessage(frameId,'AUTO_PAGE_EDITOR',{visible:editor}).catch(e=>status(e.message));
 });
 ui.autoImageSelect.addEventListener('change',()=>{activeId=ui.autoImageSelect.value;render();});
 chrome.runtime.onMessage.addListener((message,sender)=>{
  if(sender.tab?.id!==tabId)return;
  if(message.type.startsWith('PAGE_')){
   if(job?.kind!=='page'||message.sessionId!==job.sessionId||job.frameKeys?.get(sender.frameId??0)!==message.pageKey)return;
   if(message.type==='PAGE_CHAPTER_CHANGED'){stop('Manga bölümü değişti.');return;}
   if(message.type==='PAGE_ASSETS_FOUND'){addAssets(message.assets,sender.frameId??0,job.token);return;}
   if(message.type==='PAGE_DISCOVERY_UPDATED'||message.type==='PAGE_COLLECTION_FINISHED'){addAssets(message.assets??[],sender.frameId??0,job.token);updateDiscovery(sender.frameId??0,message.discovery);return;}
   if(message.type==='PAGE_VIEWPORT_CHANGED'){if((sender.frameId??0)===0)job.visibleFrames=new Set(message.visibleFrameUrls??[]);job.visible.set(sender.frameId??0,new Set(message.visibleUrls));job.pipeline?.update();return;}
   if(message.type==='PAGE_COLLECTION_WARNING'){job.warnings=(job.warnings??0)+1;job.warningMessage=message.message;return;}
   return;
  }
  
  if(['AUTO_IMAGE_SELECTED','AUTO_PICK_CANCELLED'].includes(message.type)&&message.jobOwner&&message.jobOwner!==lease?.owner)return;
  if(message.type==='AUTO_IMAGE_SELECTED'){void selectedImage(message,sender);return;}
  if(message.type==='AUTO_PICK_CANCELLED'){releaseLease();status(message.reason);return;}
  const item=assets.get(message.assetId);if(!item)return;
  if(message.type==='AUTO_DISPLAY_STATE'){
   const r=item.regions.find(r=>r.id===message.regionId);
   if(!r||r.displaySession!==message.layoutSession||(r.revision||0)!==message.revision||(r.editRevision||0)!==message.editRevision||!r.record?.overlayVisible)return;
   r.displayState=message.state;r.record.displayState=message.state;
   r.status=message.state==='waiting-for-image'?'Çeviri hazır; görselin okuyucuya dönmesi bekleniyor.':'Özgün konumunda gösteriliyor.';
   if(message.fallbackReason)r.status+=' '+message.fallbackReason;
   render();return;
  }
  if(message.type==='AUTO_FOCUS_REGION')void focusRegion(message.regionId);
   if(message.type==='AUTO_TEXT_EDITED'){
    const r=item.regions.find(r=>r.id===message.regionId);
    if(!r||typeof message.text!=='string'||message.text.length>50000||message.revision!==(r.revision||0)||message.editRevision<=(r.editRevision||0))return;
    rememberUndo(r);item.edited=true;r.turkish=message.text;r.targetCorrected=true;r.editRevision=message.editRevision;
    if(message.textStyle)r.textStyle=message.textStyle;if(message.drawingEdits)r.drawingEdits=message.drawingEdits;
    if(r.record)r.record.correctedTranslation=message.text;
    callbacks.onText?.(r.id,r.english,r.turkish,r.assetId);saveEdit(item);render();return;
   }
  if(message.type==='AUTO_REGIONS_CHANGED'){
   const selectionOnly=message.selectionOnly===true&&message.regions.length===item.regions.length&&message.regions.every(r=>{
    const old=item.regions.find(prior=>prior.id===r.id);return old&&old.revision===r.revision&&old.kind===r.kind&&old.displayOverride===r.displayOverride&&['x','y','width','height'].every(k=>old.bounds[k]===r.bounds[k]);
   });
   if(job&&!(selectionOnly&&job.kind==='page'&&job.counts?.waiting&&!job.manualBusy))stop('Alan değişti. Metin düzeltmelerin korundu.');
   geometryChanged(item,message.regions);
  }
  if(message.type==='AUTO_INVALIDATED'){stop(message.reason);item.error=message.reason;for(const r of item.regions)callbacks.onInvalidated?.(r.id);if(!item.descriptor.pageManaged)item.regions=[];render();}
 });
 chrome.tabs.onActivated.addListener(({tabId:activated})=>{
  if(surface)return;
  if(!job)void preflight();else if(job.kind!=='page'&&activated!==tabId)stop('Sekme değişti. Tamamlanan çeviriler korundu.');
 });
 chrome.tabs.onUpdated.addListener((id,change)=>{if(surface&&id!==surface.tab?.id)return;if(change.status==='loading'&&id===tabId)preview=undefined;if(change.status==='complete'&&!job){if(id===tabId&&[...assets.values()].some(a=>a.descriptor.pageManaged))void restorePage().catch(e=>{if(e.name!=='AbortError')status('Sayfa çevirileri açılamadı: '+e.message);});else void preflight();}});
 window.addEventListener('pagehide',()=>{releaseLease();job?.abort.abort();releaseSource();void disposeOcr();stopDetection();for(const port of ports.values())port.disconnect();});
 chrome.runtime.onMessage.addListener((message,sender)=>{
  if(surface&&message?.type==='MANGA_WIDGET_STOP'&&sender.id===chrome.runtime.id&&!sender.tab&&message.instance===new URLSearchParams(location.search).get('instance'))stop('Okuyucudan ayrıldın. Çeviri durduruldu.');
 });
 void Promise.resolve().then(()=>callbacks.ready?.()).then(async()=>{
  if(surface)await surface.initialize(callbacks.ready?.());
  await preflight();
 }).catch(error=>status('Başlatılamadı: '+error.message));
 render();
 return {
  stop,
   reset:clear,
   async restyle(){stop('Görünüm güncellendi.');for(const item of assets.values()){item.settings={...settingsFor(item),textStyle:{...getProductSettings().textStyle}};item.readingKey=undefined;for(const r of item.regions){r.textStyle=item.settings.textStyle;if(r.turkish?.trim())await this.show(r.id,r.turkish);}await persist(item,item.edited===true);}},
   sourceEdited(id,text){const r=find(id);if(!r)return;rememberUndo(r);owner(r).edited=true;r.english=text;r.sourceCorrected=true;r.selected=true;delete r.skipReason;r.turkish='';r.editRevision++;void send('AUTO_EDIT_REVISION',{selectionId:id,editRevision:r.editRevision},owner(r)).catch(()=>{});r.status='Kaynak metin değişti. Yeniden çevirebilirsin.';saveEdit(owner(r));render();},
   targetEdited(id,text){const r=find(id);if(!r)return;rememberUndo(r);owner(r).edited=true;r.turkish=text;r.targetCorrected=true;r.editRevision++;void send('AUTO_EDIT_REVISION',{selectionId:id,editRevision:r.editRevision},owner(r)).catch(()=>{});saveEdit(owner(r));render();},
   async fillFocused(){
    if(job&&!job.counts?.waiting)throw Error('Önce çeviriyi durdur.');
    const item=assets.get(activeId),focused=find(focusId),r=focused?.assetId===activeId?focused:item?.regions.filter(r=>r.selected).length===1?item.regions.find(r=>r.selected):null;
    if(!r)throw Error('Temizlenecek tek alanı numarasından seç.');
    if(!r.turkish?.trim())throw Error('Dolgu için önce bu alanın çevirisini hazırla.');
    await ensureOcr(r,epoch);rememberUndo(r);r.drawingEdits=[...(r.drawingEdits??[]),{type:'fill',color:r.crop.background.color}];r.editRevision++;item.edited=true;
    await push(item);await showRegion(r);await persist(item,true);status('Seçili alan temizlendi.');
   },
   async undo(){const saved=undoEdits.pop(),r=saved&&find(saved.id);if(!r||r.assetId!==saved.assetId)throw Error('Bu sayfada geri alınacak düzenleme yok.');Object.assign(r,saved,{editRevision:(r.editRevision||0)+1});const item=owner(r);item.edited=true;await push(item);if(r.turkish?.trim())await this.show(r.id,r.turkish);else await hide(r);await persist(item,true);callbacks.onText?.(r.id,r.english,r.turkish,r.assetId);render();status('Son düzenleme geri alındı.');},
   async exportPages(chapter=false){
    if(job&&!job.counts?.waiting)throw Error('Çıktı almadan önce bölüm işlemini durdur veya bitmesini bekle.');
    if(chapter&&incompleteChapter)throw Error('Bölümün tam listesi doğrulanmadı veya bazı sayfaları eksik. Tamamlanan sayfaları tek tek PNG olarak alabilirsin.');
    const items=chapter?[...assets.values()].sort((a,b)=>a.index-b.index):[assets.get(activeId)].filter(Boolean);
    if(!items.length)throw Error('Önce bir sayfayı çevir.');
    const incomplete=items.filter(item=>item.error||['queued','detecting'].includes(item.state)||item.regions.some(r=>r.selected&&!r.turkish?.trim()));
    if(incomplete.length)throw Error(incomplete.length+' sayfanın çevirisi eksik. Yeniden dene veya eksik alanları seçimden çıkar.');
    const pages=[];
    for(const item of items){
     await send('AUTO_CHECK_IMAGE',{},item);const source=await readBlob(item,epoch);
     const snapshots=new Map(((await send('AUTO_EXPORT_REGIONS',{},item)).regions??[]).map(region=>[region.id,region]));
     const regions=item.regions.map(region=>{const snapshot=snapshots.get(region.id);return {...snapshot,...region,
      text:region.turkish,targetText:region.turkish,renderLayout:snapshot&&snapshot.text===region.turkish?snapshot.renderLayout:undefined,
      textStyle:region.textStyle??settingsFor(item).textStyle,targetDirection:getTargetLanguage(settingsFor(item).targetLanguage).direction};});
     pages.push({name:String(item.index).padStart(4,'0')+'.png',blob:await renderPage(source,regions,{style:settingsFor(item).textStyle})});
    }
    return pages;
   },
  async show(id,text){const r=find(id);if(!r)throw Error('Alan değişti. Yeniden seç.');const token=epoch;r.turkish=text;await ensureOcr(r,token);check(token);return showRegion(r,text,token);},
 };
}

