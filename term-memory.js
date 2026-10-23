const MAX_TERMS=500,MAX_PHRASES=2000;
function entry(value){
 if(!value||typeof value.source!=='string'||typeof value.target!=='string')throw Error('Sözlük girdisi kaynak ve hedef metin içermeli.');
 const source=value.source.normalize('NFC').trim(),target=value.target.normalize('NFC').trim();
 if(!source||!target||source.length>5000||target.length>5000)throw Error('Sözlük girdisi boş veya çok uzun.');
 if(/[\uE000\uE001]|ZXQ\d+QXZ/iu.test(source+target))throw Error('Sözlük girdisi ayrılmış işaret içeriyor.');
 return {source,target};
}
function entries(values,limit){
 if(!Array.isArray(values)||values.length>limit)throw Error('Sözlük listesi geçersiz veya çok uzun.');
 const seen=new Set();
 return values.map(value=>{const item=entry(value);if(seen.has(item.source))throw Error('Aynı kaynak için birden fazla sözlük girdisi var.');seen.add(item.source);return item;})
  .sort((a,b)=>a.source<b.source?-1:a.source>b.source?1:0);
}
export function validateTermMemory(memory={}){
 if(!memory||typeof memory!=='object'||Array.isArray(memory))throw Error('Geçersiz seri sözlüğü.');
 return {terms:entries(memory.terms??[],MAX_TERMS),phrases:entries(memory.phrases??[],MAX_PHRASES)};
}
export async function termMemoryVersion(memory={}){
 const bytes=new TextEncoder().encode(JSON.stringify(validateTermMemory(memory)));
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export function findPhraseTranslation(text,memory={}){
 const source=String(text).normalize('NFC').trim();
 return validateTermMemory(memory).phrases.find(item=>item.source===source)?.target??null;
}
function wordCharacter(character){return Boolean(character&&/[\p{L}\p{N}\p{M}_]/u.test(character));}
function termBoundary(character,neighbor){
 return !wordCharacter(character)||/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)||!wordCharacter(neighbor);
}

// Only explicitly configured complete terms are protected, never substrings.
export function prepareTerms(text,memory={}){
 text=String(text).normalize('NFC');
 const configured=validateTermMemory(memory).terms.sort((a,b)=>b.source.length-a.source.length),replacements=[];
 if(/[\uE000\uE001]|ZXQ\d+QXZ/iu.test(text))return {text,restore:result=>String(result)};
 let protectedText='';
 for(let i=0;i<text.length;){
  const term=configured.find(item=>text.startsWith(item.source,i)&&
   termBoundary(item.source[0],text[i-1])&&termBoundary(item.source.at(-1),text[i+item.source.length]));
  if(!term){protectedText+=text[i++];continue;}
  const token='ZXQ'+String(replacements.length).padStart(4,'0')+'QXZ';replacements.push({token,target:term.target});protectedText+=token;i+=term.source.length;
 }
 return {text:protectedText,restore(result){
  result=String(result);
  for(const {token,target}of replacements){
   const marker=new RegExp(token,'gi');if((result.match(marker)??[]).length!==1)return null;
   result=result.replace(marker,()=>target);
  }
  return /[\uE000\uE001]|ZXQ\d+QXZ/iu.test(result)?null:result;
 }};
}
export async function translateWithMemory(text,memory,translate){
 const phrase=findPhraseTranslation(text,memory);if(phrase!==null)return phrase;
 const prepared=prepareTerms(text,memory),translated=await translate(prepared.text),restored=prepared.restore(translated);
 // shortcut: a translator can drop term markers; keep its ordinary result then.
 return restored??await translate(text);
}
export function parseTermLines(text){
 if(typeof text!=='string')throw Error('Sözlük metni geçersiz.');
 return entries(text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
  const separator=line.indexOf('=>');if(separator<0)throw Error('Her sözlük satırı “kaynak => hedef” biçiminde olmalı.');
  return {source:line.slice(0,separator),target:line.slice(separator+2)};
 }),MAX_TERMS);
}
