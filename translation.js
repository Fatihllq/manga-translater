import {withSignal} from './runtime-policy.js';
import { getSourceLanguage, getTargetLanguage } from './languages.js';
import {getProductSettings,getTermMemory} from './product-state.js';
import {translateWithMemory} from './term-memory.js';

const translators = new Map();

export function hasTranslator(source, target) {
  return translators.has(`${source}:${target}`);
}
export function releaseTranslators(source,target){
  const keep=source&&target?`${source}:${target}`:null;
  for(const [key,creating]of translators)if(key!==keep){
    translators.delete(key);void creating.then(translator=>translator.destroy?.()).catch(()=>{});
  }
}

export async function checkTranslationAvailability(source, target) {
  getSourceLanguage(source);
  getTargetLanguage(target);
  if(source===target)return 'available';
  if (!('Translator' in globalThis)) return 'unavailable';
  return globalThis.Translator.availability({ sourceLanguage: source, targetLanguage: target });
}

// Call this directly from a click handler: Chrome may require user activation
// to create a new translator or download its language pack.
export function prepareTranslator(source, target, onProgress = () => {}) {
  getSourceLanguage(source);
  getTargetLanguage(target);
  if(source===target)return Promise.resolve({translate:async text=>text});
  if (!('Translator' in globalThis)) throw new Error('Bu Chrome sürümünde yerel çeviri bulunamadı.');

  const key = `${source}:${target}`;
  if (!translators.has(key)) {
    const creating = globalThis.Translator.create({
      sourceLanguage: source,
      targetLanguage: target,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          onProgress(Math.round(event.loaded * 100));
        });
      },
    });
    translators.set(key, creating);
    creating.catch(() => {if(translators.get(key)===creating)translators.delete(key);});
  }

  return translators.get(key);
}


const translationQueue=[];let translationRunning=false,translationSequence=0;
function pumpTranslations(){
 if(translationRunning)return;
 translationQueue.sort((a,b)=>a.priority-b.priority||a.sequence-b.sequence);
 let job;
 while(translationQueue.length){job=translationQueue.shift();if(!job.cancelled)break;job.signal?.removeEventListener('abort',job.abort);job=undefined;}
 if(!job)return;
 translationRunning=true;
 void (async()=>{
  try{const translator=await withSignal(job.preparing,job.signal);if(job.signal?.aborted)throw new DOMException('Durduruldu.','AbortError');
   const result=await translator.translate(job.text,job.signal?{signal:job.signal}:undefined);
   if(job.signal?.aborted)throw new DOMException('Durduruldu.','AbortError');job.resolve(result);
  }catch(error){job.reject(error);}
  finally{job.signal?.removeEventListener('abort',job.abort);translationRunning=false;pumpTranslations();}
 })();
}
async function translateRaw(text,source,target,onProgress=()=>{},options={}){
 if(!text.trim())throw Error('Önce kaynak metni gir.');
 if(options.signal?.aborted)throw new DOMException('Durduruldu.','AbortError');
 const preparing=prepareTranslator(source,target,onProgress);
 preparing.catch(()=>{});
 return new Promise((resolve,reject)=>{
  const job={text:text.trim(),preparing,resolve,reject,signal:options.signal,priority:options.priority??0,
   sessionId:options.sessionId,sequence:++translationSequence,cancelled:false};
  job.abort=()=>{job.cancelled=true;translationQueue.splice(translationQueue.indexOf(job),translationQueue.includes(job)?1:0);job.signal?.removeEventListener('abort',job.abort);reject(new DOMException('Durduruldu.','AbortError'));};
  job.signal?.addEventListener('abort',job.abort,{once:true});translationQueue.push(job);pumpTranslations();
 });
}
export async function translate(text,source,target,onProgress=()=>{},options={}){
 if(options.signal?.aborted)throw new DOMException('Durduruldu.','AbortError');
 const memory=options.termMemory??getTermMemory({...getProductSettings(),sourceLanguage:source,targetLanguage:target});
 return translateWithMemory(text,memory,value=>translateRaw(value,source,target,onProgress,options));
}
