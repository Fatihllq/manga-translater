// These checks only gate automatic translation; reviewed text can always proceed.
export function automaticEligibility(region,sourceLanguage=region.sourceLanguage??'en') {
 if(region.manual||region.sourceCorrected||region.automaticOverride||region.displayGeometry?.mode==='inside')return {eligible:true,reason:null};
 const text=String(region.sourceText??region.english??region.ocr?.text??'').trim();
 if(sourceLanguage!=='en'){
  const scripts={ja:/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}]/u,
   ko:/[\p{Script=Hangul}\p{Script=Latin}]/u,zh:/[\p{Script=Han}\p{Script=Latin}]/u};
  return scripts[sourceLanguage]?.test(text)?{eligible:true,reason:null}:{eligible:false,reason:'source-script'};
 }
 if(!/\p{Script=Latin}/u.test(text))return {eligible:false,reason:'no-latin'};
 const words=text.match(/\p{L}+/gu)??[],single=words.filter(word=>/^\p{Script=Latin}$/u.test(word)).length;
 const bounds=region.textBounds??region.bounds;
 const vertical=bounds?.height>=bounds?.width*1.8;
 if(vertical&&words.length>=3&&single/words.length>=.7&&Number.isFinite(region.ocr?.confidence)&&region.ocr.confidence<60)return {eligible:false,reason:'vertical-fragments'};
 return {eligible:true,reason:null};
}
