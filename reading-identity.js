import './features.js';
import {getSourceLanguage} from './languages.js';
import {makeReadingKey} from './reading-store.js';
import {getTermMemory,TRANSLATION_VERSION,DISPLAY_VERSION} from './product-state.js';
import {termMemoryVersion} from './term-memory.js';

let detectorIdentity;
// Site pages and imported files share the same model, policy and glossary identity.
export async function pageReadingKey(sha256,settings){
 const detector=await(detectorIdentity??=fetch(new URL('./detector-version.json',import.meta.url)).then(response=>{
  if(!response.ok)throw Error('Algılama sürümü okunamadı.');return response.json();
 }).catch(error=>{detectorIdentity=undefined;throw error;}));
 return makeReadingKey({sha256,sourceLanguage:settings.sourceLanguage,targetLanguage:settings.targetLanguage,
  ocrVersion:getSourceLanguage(settings.sourceLanguage).paddleVersion+':'+globalThis.__mangaFeatures.version+':'+detector.sha256,
  translationVersion:TRANSLATION_VERSION,glossaryVersion:await termMemoryVersion(getTermMemory(settings)),
  displayVersion:DISPLAY_VERSION+JSON.stringify(settings.textStyle)});
}
