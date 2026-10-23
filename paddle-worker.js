import {PaddleEngine} from './paddle-engine.js';
let engine;
self.onmessage=async({data:{id,imageDataUrl,path,rowBoxes,prepare,sourceLanguage='en'}})=>{try{
 if(engine&&engine.sourceLanguage!==sourceLanguage){await engine.release();engine=undefined;}
 engine??=new PaddleEngine({sourceLanguage,threads:Math.min(4,Math.max(1,Math.floor((navigator.hardwareConcurrency||2)/2)))});
 self.postMessage({id,result:prepare?await engine.prepare():await engine.recognize(imageDataUrl,path,rowBoxes)});
 }catch(error){self.postMessage({id,error:error.message});}};
