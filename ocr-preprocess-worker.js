import {transformPreparationPixels} from './ocr-preprocess.js';
self.onmessage=async({data:job})=>{let canvas;try{
 const transformed=transformPreparationPixels({data:new Uint8ClampedArray(job.buffer),width:job.width,height:job.height},job.recipe,job.features);
 canvas=new OffscreenCanvas(transformed.width,transformed.height);canvas.getContext('2d').putImageData(new ImageData(transformed.data,transformed.width,transformed.height),0,0);
 const blob=await canvas.convertToBlob({type:'image/png'});self.postMessage({id:job.id,blob,width:transformed.width,height:transformed.height});
 }catch(error){self.postMessage({id:job.id,error:String(error.message??error)});}finally{if(canvas)canvas.width=canvas.height=1;}};
