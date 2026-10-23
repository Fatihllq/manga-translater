import {openDatabase,READING_STORES} from './db.js';

export const READING_CACHE_LIMIT=64*1024*1024;
const RECORD_LIMIT=4*1024*1024,BACKUP_LIMIT=128*1024*1024,MAX_RECORDS=10000;
const encoder=new TextEncoder();
const omitted=new Set(['imageDataUrl','rawImageDataUrl','sourceImageDataUrl','blob','crop','record','ocrPromise','tabId','frameId','cleanupPatch','inlineRegion']);

function metadata(value,depth=0){
 if(depth>24)throw Error('Kayıt çok fazla iç içe alan içeriyor.');
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Geçersiz sayısal kayıt.');return value;}
 if(typeof value==='string'){if(value.length>1000000)throw Error('Kayıt metni çok uzun.');return value;}
 if(Array.isArray(value)){if(value.length>10000)throw Error('Kayıt listesi çok uzun.');return value.map(v=>metadata(v,depth+1));}
 if(value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){
  const result={};
  for(const [key,item]of Object.entries(value)){
   if(['__proto__','constructor','prototype'].includes(key))throw Error('Geçersiz kayıt alanı.');
   if(omitted.has(key)||item===undefined||key==='imageUrl'&&typeof item==='string'&&/^(data:|blob:)/.test(item))continue;
   result[key]=metadata(item,depth+1);
  }
  return result;
 }
 throw Error('Yalnızca taşınabilir kayıt verileri saklanabilir.');
}
function size(value){return encoder.encode(JSON.stringify(value)).byteLength;}
function keyString(key){if(typeof key!=='string'||!key||key.length>4096)throw Error('Geçersiz okuma anahtarı.');return key;}
function pageValue(value){
 const clean=metadata(value);
 if(!clean||Array.isArray(clean)||!Array.isArray(clean.regions)||clean.regions.length>5000)throw Error('Geçersiz okuma kaydı.');
 for(const region of clean.regions){
  if(!region||typeof region!=='object'||Array.isArray(region))throw Error('Geçersiz yazı alanı.');
  for(const name of ['english','turkish','sourceText','targetText'])if(region[name]!==undefined&&(typeof region[name]!=='string'||region[name].length>50000))throw Error('Geçersiz alan metni.');
  for(const bounds of [region.bounds,region.textBounds,region.bubbleBounds])if(bounds&&['x','y','width','height'].some(k=>!Number.isFinite(bounds[k])||bounds[k]<0||bounds[k]>10000000))throw Error('Geçersiz alan koordinatı.');
 }
 if(size(clean)>RECORD_LIMIT)throw Error('Tek sayfa kaydı 4 MiB sınırını aşıyor.');
 return clean;
}
function makeRecord(key,value,updatedAt=Date.now()){
 if(!Number.isFinite(updatedAt)||updatedAt<0)throw Error('Geçersiz kayıt tarihi.');
 const record={key:keyString(key),value:pageValue(value),updatedAt};record.bytes=size(record);return record;
}
async function withStores(names,mode,enqueue){
 const db=await openDatabase();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(names,mode);let result;
  tx.oncomplete=()=>{try{resolve(typeof result==='function'?result():result);}catch(error){reject(error);}};
  tx.onerror=()=>reject(tx.error??Error('Okuma kaydı saklanamadı.'));
  tx.onabort=()=>reject(tx.error??new DOMException('Okuma kaydı işlemi iptal edildi.','AbortError'));
  try{result=enqueue(tx);}catch(error){tx.abort();reject(error);}
 });
}
function evict(store,records){
 let bytes=records.reduce((sum,item)=>sum+item.bytes,0),count=records.length;
 for(const record of records.sort((a,b)=>a.updatedAt-b.updatedAt||a.key.localeCompare(b.key))){
  if(bytes<=READING_CACHE_LIMIT&&count<=MAX_RECORDS)break;
  store.delete(record.key);bytes-=record.bytes;count--;
 }
}

// Cache identity includes every setting that can change an automatic result.
export function makeReadingKey({sha256,sourceLanguage,targetLanguage,ocrVersion,translationVersion,glossaryVersion,displayVersion}){
 if(typeof sha256!=='string'||!/^[a-f\d]{64}$/i.test(sha256))throw Error('Görsel içerik özeti geçersiz.');
 for(const language of [sourceLanguage,targetLanguage])if(typeof language!=='string'||!/^\w{2,3}(?:-[\w]+)*$/.test(language))throw Error('Okuma dili geçersiz.');
 const versions=[ocrVersion,translationVersion,glossaryVersion,displayVersion];
 if(versions.some(v=>typeof v!=='string'||v.length>512))throw Error('Okuma sürümü geçersiz.');
 return JSON.stringify([1,sha256.toLowerCase(),sourceLanguage,targetLanguage,...versions]);
}
async function readCurrent(key){
 keyString(key);
 return withStores([READING_STORES.pages,READING_STORES.edits],'readonly',tx=>{
  const page=tx.objectStore(READING_STORES.pages).get(key),edit=tx.objectStore(READING_STORES.edits).get(key);
  return ()=>{const record=edit.result??page.result;return record?{...record.value,key,updatedAt:record.updatedAt,edited:Boolean(edit.result)}:null;};
 });
}
export async function loadReading(key){
 const current=await readCurrent(key);if(current)return current;
 let parts;try{parts=JSON.parse(key);}catch{return null;}
 if(!Array.isArray(parts)||parts.length!==8||!String(parts[7]).startsWith('inline-v1:'))return null;
 parts[4]=parts[4].replace(':0.6.0:',':0.5.0:');parts[7]=parts[7].replace(/^inline-v1:/,'safe-layout-v3');
 try{const style=JSON.parse(parts[7].slice('safe-layout-v3'.length));if(style.align==='auto'){style.align='center';parts[7]='safe-layout-v3'+JSON.stringify(style);}}catch{return null;}
 const legacy=await readCurrent(JSON.stringify(parts));if(!legacy)return null;
 const value={...legacy,key,readingKey:key};await saveReading(key,value);if(legacy.edited)await saveReadingEdit(key,legacy.regions);
 return {...value,migratedFrom:'0.5.0'};
}
export async function saveReading(key,value){
 const record=makeRecord(key,value);
 return withStores(READING_STORES.pages,'readwrite',tx=>{
  const store=tx.objectStore(READING_STORES.pages),all=store.getAll();
  all.onsuccess=()=>{store.put(record);evict(store,[...all.result.filter(item=>item.key!==key),record]);};
  return record.value;
 });
}
export async function saveReadingEdit(key,regions){
 keyString(key);const clean=pageValue({regions}).regions;
 return withStores([READING_STORES.pages,READING_STORES.edits],'readwrite',tx=>{
  const page=tx.objectStore(READING_STORES.pages).get(key),store=tx.objectStore(READING_STORES.edits),previous=store.get(key);
  previous.onsuccess=()=>store.put(makeRecord(key,{...(page.result?.value??previous.result?.value??{}),regions:clean,edited:true}));
  return clean;
 });
}
export async function listReadingHistory(){
 return withStores([READING_STORES.pages,READING_STORES.edits],'readonly',tx=>{
  const pages=tx.objectStore(READING_STORES.pages).getAll(),edits=tx.objectStore(READING_STORES.edits).getAll();
  return ()=>{
   const history=new Map(pages.result.map(record=>[record.key,{...record.value,key:record.key,updatedAt:record.updatedAt,edited:false}]));
   for(const record of edits.result)history.set(record.key,{...record.value,key:record.key,updatedAt:record.updatedAt,edited:true});
   return [...history.values()].sort((a,b)=>b.updatedAt-a.updatedAt);
  };
 });
}
export async function clearReadingHistory(){
 return withStores(READING_STORES.pages,'readwrite',tx=>{tx.objectStore(READING_STORES.pages).clear();});
}
export async function deleteReadingEdit(key){
 keyString(key);return withStores(READING_STORES.edits,'readwrite',tx=>{tx.objectStore(READING_STORES.edits).delete(key);});
}
function settingsValue(value){
 const clean=metadata(value);
 if(!clean||Array.isArray(clean)||typeof clean!=='object'||size(clean)>1024*1024)throw Error('Geçersiz okuma ayarları.');
 return clean;
}
export async function getReadingSettings(){
 return withStores(READING_STORES.settings,'readonly',tx=>{
  const request=tx.objectStore(READING_STORES.settings).get('preferences');return ()=>request.result?.value??{};
 });
}
export async function saveReadingSettings(value){
 const clean=settingsValue(value);
 return withStores(READING_STORES.settings,'readwrite',tx=>{tx.objectStore(READING_STORES.settings).put({key:'preferences',value:clean});return clean;});
}
export async function exportReadingBackup(){
 return withStores(Object.values(READING_STORES),'readonly',tx=>{
  const pages=tx.objectStore(READING_STORES.pages).getAll(),edits=tx.objectStore(READING_STORES.edits).getAll(),settings=tx.objectStore(READING_STORES.settings).get('preferences');
  return ()=>{
   const backup={format:'manga-reading',schemaVersion:1,exportedAt:new Date().toISOString(),pages:pages.result,edits:edits.result,settings:settings.result?.value??{}};
   if(size(backup)>BACKUP_LIMIT)throw Error('Okuma yedeği 128 MiB sınırını aşıyor. Önce otomatik geçmişi temizle.');
   return backup;
  };
 });
}
export async function importReadingBackup(backup){
 if(!backup||backup.format!=='manga-reading'||backup.schemaVersion!==1||!Array.isArray(backup.pages)||!Array.isArray(backup.edits)||backup.pages.length+backup.edits.length>MAX_RECORDS||size(backup)>BACKUP_LIMIT)throw Error('Okuma yedeğinin biçimi veya boyutu geçersiz.');
 const pages=backup.pages.map(item=>makeRecord(item.key,item.value,item.updatedAt)),edits=backup.edits.map(item=>makeRecord(item.key,item.value,item.updatedAt)),settings=settingsValue(backup.settings??{});
 for(const records of [pages,edits])if(new Set(records.map(item=>item.key)).size!==records.length)throw Error('Okuma yedeği yinelenen anahtar içeriyor.');
 return withStores(Object.values(READING_STORES),'readwrite',tx=>{
  const store=tx.objectStore(READING_STORES.pages),existing=store.getAll();
  existing.onsuccess=()=>{
   const merged=new Map(existing.result.map(item=>[item.key,item]));for(const item of pages){store.put(item);merged.set(item.key,item);}evict(store,[...merged.values()]);
  };
  for(const item of edits)tx.objectStore(READING_STORES.edits).put(item);
  tx.objectStore(READING_STORES.settings).put({key:'preferences',value:settings});
  return pages.length+edits.length;
 });
}
