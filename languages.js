// OCR language support and Chrome translation availability are independent.
export const SOURCE_LANGUAGES = Object.freeze({
  en: Object.freeze({
    name: 'İngilizce',
    direction: 'ltr',
    ocrEngine: 'tesseract',
    ocrCode: 'eng',
    modelVersion: 'eng-best-int-4.0.0',
    paddleVersion: 'ppocr-v5-mobile-en-rapidocr-3.10.0',
    writingMode: 'horizontal-tb',
  }),
  ja: Object.freeze({name:'Japonca',direction:'ltr',writingMode:'auto',ocrEngine:'paddle',
    modelVersion:'ppocr-v5-mobile-cjk-rapidocr-3.10.0',paddleVersion:'ppocr-v5-mobile-cjk-rapidocr-3.10.0',beta:true}),
  ko: Object.freeze({name:'Korece',direction:'ltr',writingMode:'horizontal-tb',ocrEngine:'paddle',
    modelVersion:'ppocr-v5-mobile-ko-rapidocr-3.10.0',paddleVersion:'ppocr-v5-mobile-ko-rapidocr-3.10.0',beta:true}),
  zh: Object.freeze({name:'Çince',direction:'ltr',writingMode:'auto',ocrEngine:'paddle',
    modelVersion:'ppocr-v5-mobile-cjk-rapidocr-3.10.0',paddleVersion:'ppocr-v5-mobile-cjk-rapidocr-3.10.0',beta:true}),
});

// These are candidates, not a promise: the UI checks Translator.availability for the selected pair.
const targetNames={tr:'Türkçe',en:'İngilizce',ja:'Japonca',ko:'Korece',zh:'Çince','zh-Hant':'Geleneksel Çince',
 ar:'Arapça',bg:'Bulgarca',bn:'Bengalce',cs:'Çekçe',da:'Danca',de:'Almanca',el:'Yunanca',es:'İspanyolca',
 fi:'Fince',fr:'Fransızca',he:'İbranice',hi:'Hintçe',hr:'Hırvatça',hu:'Macarca',id:'Endonezce',it:'İtalyanca',
 kn:'Kannadaca',lt:'Litvanca',mr:'Marathice',nl:'Felemenkçe',no:'Norveççe',pl:'Lehçe',pt:'Portekizce',
 ro:'Rumence',ru:'Rusça',sk:'Slovakça',sl:'Slovence',sv:'İsveççe',ta:'Tamilce',te:'Teluguca',th:'Tayca',uk:'Ukraynaca',vi:'Vietnamca'};
export const TARGET_LANGUAGES=Object.freeze(Object.fromEntries(Object.entries(targetNames)
 .map(([code,name])=>[code,Object.freeze({name,direction:['ar','he'].includes(code)?'rtl':'ltr'})])));

export const DEFAULT_LANGUAGE_PAIR = Object.freeze({ source: 'en', target: 'tr' });

export function getSourceLanguage(code) {
  const language = SOURCE_LANGUAGES[code];
  if (!language) throw new Error(`Desteklenmeyen kaynak dil: ${code}`);
  return language;
}

export function getTargetLanguage(code) {
  const language = TARGET_LANGUAGES[code];
  if (!language) throw new Error(`Desteklenmeyen hedef dil: ${code}`);
  return language;
}
