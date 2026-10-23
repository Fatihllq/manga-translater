import {getSourceLanguage,getTargetLanguage} from './languages.js';
import {validateTermMemory} from './term-memory.js';
export const TRANSLATION_VERSION='chrome-local-v3';
export const DISPLAY_VERSION='inline-v1:';
const defaults={sourceLanguage:'en',targetLanguage:'tr',series:'Genel',textStyle:{fontFamily:'sans-serif',scale:1,color:null,align:'auto'},glossaries:{}};
let settings=structuredClone(defaults);
export function getProductSettings(){return settings;}
export function validateProductSettings(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Geçersiz ürün ayarları.');
 const sourceLanguage=value.sourceLanguage===undefined?defaults.sourceLanguage:value.sourceLanguage,targetLanguage=value.targetLanguage===undefined?defaults.targetLanguage:value.targetLanguage;
 getSourceLanguage(sourceLanguage);getTargetLanguage(targetLanguage);
 if(value.textStyle!==undefined&&(!value.textStyle||typeof value.textStyle!=='object'||Array.isArray(value.textStyle)))throw Error('Geçersiz görünüm ayarı.');
 const style={...defaults.textStyle,...value.textStyle};
 if(!['sans-serif','serif','comic'].includes(style.fontFamily)||!['auto','left','center','right'].includes(style.align)||!Number.isFinite(style.scale)||style.scale<.5||style.scale>2||style.color!==null&&!/^#[0-9a-f]{6}$/i.test(style.color))throw Error('Geçersiz görünüm ayarı.');
 if(value.series!==undefined&&(typeof value.series!=='string'||value.series.length>100))throw Error('Geçersiz seri adı.');
 if(value.glossaries!==undefined&&(!value.glossaries||typeof value.glossaries!=='object'||Array.isArray(value.glossaries)))throw Error('Geçersiz seri sözlükleri.');
 if(Object.keys(value.glossaries??{}).length>100)throw Error('En fazla 100 seri/dil sözlüğü saklanabilir.');
 const glossaries={};
 for(const [key,memory]of Object.entries(value.glossaries??{})){if(key.length>200||['__proto__','constructor','prototype'].includes(key))throw Error('Geçersiz sözlük anahtarı.');glossaries[key]=validateTermMemory(memory);}
 return {sourceLanguage,targetLanguage,series:value.series?.trim()||defaults.series,textStyle:style,glossaries};
}
export function updateProductSettings(value={}){settings=validateProductSettings(value);return settings;}
export function glossaryKey(value=settings){return `${value.series}\n${value.sourceLanguage}:${value.targetLanguage}`;}
export function getTermMemory(value=settings){return value.glossaries?.[glossaryKey(value)]??{terms:[],phrases:[]};}
