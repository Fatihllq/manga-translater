import {preprocessGlobal,verticalPadding,recognitionTensor,bgrTensor,bankersRound,perspectiveCrop} from './paddle-pixels.js';
import {decodeDetection,decodeCtc,lineResult,orderPaddleLines,joinPaddleLines} from './paddle-postprocess.js';
import {getSourceLanguage} from './languages.js';
export class PaddleEngine {
 constructor({base=new URL('./',import.meta.url),threads=1,sourceLanguage='en'}={}){getSourceLanguage(sourceLanguage);this.base=base;this.threads=threads;this.sourceLanguage=sourceLanguage;this.sessions=new Map();this.closed=false;}
 async modelInfo(){
  if(this.sourceLanguage==='en')return {model:{file:'en_PP-OCRv5_rec_mobile.onnx'},characters:{file:'characters.json'}};
  if(!this.info)this.info=(async()=>{
   const response=await fetch(new URL('vendor/paddle/languages.json',this.base));
   if(response.ok===false)throw Error('Paddle dil modeli bulunamadı.');
   const registry=await response.json(),info=registry.schemaVersion===1&&registry.languages?.[this.sourceLanguage];
   if(!info||!/^\w[\w.-]*\.onnx$/.test(info.model?.file)||!/^characters[\w-]*\.json$/.test(info.characters?.file)||!Number.isInteger(info.characters.count)||info.characters.count<2)throw Error('Geçersiz Paddle dil modeli.');
   return info;
  })();
  try{return await this.info;}catch(error){this.info=undefined;throw error;}
 }
 async loadCharacters(){
  if(!this.characters){const info=await this.modelInfo(),response=await fetch(new URL('vendor/paddle/'+info.characters.file,this.base));
   if(response.ok===false)throw Error('Paddle karakter tablosu bulunamadı.');
   const characters=await response.json();
   if(!Array.isArray(characters)||characters.some(c=>typeof c!=='string')||characters.length<2||(info.characters.count&&characters.length!==info.characters.count))throw Error('Paddle character dictionary/model mismatch');
   this.characters=characters;
  }return this.characters;
 }
 async runtime(){if(!this.ort){this.ort=await import(new URL('vendor/onnx/ort.wasm.min.mjs',this.base));this.ort.env.wasm.wasmPaths=new URL('vendor/onnx/',this.base).href;this.ort.env.wasm.numThreads=globalThis.crossOriginIsolated?this.threads:1;}return this.ort;}
 async session(kind){
  if(this.closed)throw Error('Paddle worker closed');
  if(!this.sessions.has(kind))this.sessions.set(kind,(async()=>{const ort=await this.runtime(),name=kind==='rec'?(await this.modelInfo()).model.file:'ch_PP-OCRv5_det_mobile.onnx';
   return ort.InferenceSession.create(new URL('vendor/paddle/'+name,this.base).href,{executionProviders:['wasm']});})());
  try{return await this.sessions.get(kind);}catch(error){this.sessions.delete(kind);throw error;}
 }
 async infer(kind,input){const ort=await this.runtime(),session=await this.session(kind),tensor=new ort.Tensor('float32',input.data,input.dims);let outputs;
  try{outputs=await session.run({[session.inputNames[0]]:tensor});const output=outputs[session.outputNames[0]];return {data:Float32Array.from(output.data),dims:[...output.dims]};}
  finally{tensor.dispose();for(const t of Object.values(outputs??{}))t.dispose();}
 }
 async prepare(){await Promise.all([this.session('det'),this.session('rec')]);}
 async recognizePixels(original,path='line',rowBoxes){
  const start=performance.now();
  if(path==='rows'){
   if(!Array.isArray(rowBoxes)||rowBoxes.length<2||rowBoxes.length>8||rowBoxes.some((b,i)=>![b.x0,b.y0,b.x1,b.y1].every(Number.isInteger)||b.x0<0||b.y0<0||b.x1>original.width||b.y1>original.height||b.x1<=b.x0||b.y1<=b.y0||(b.x1-b.x0)/(b.y1-b.y0)>6.4||(i&&b.y0<rowBoxes[i-1].y1)))
    throw Error('Invalid or unbounded Paddle row boxes');
   const tensors=rowBoxes.map(b=>{
    const width=b.x1-b.x0,height=b.y1-b.y0,data=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++)data.set(original.data.subarray(((b.y0+y)*original.width+b.x0)*4,((b.y0+y)*original.width+b.x1)*4),y*width*4);
    return recognitionTensor({data,width,height});
   });
   const size=3*48*320,data=new Float32Array(rowBoxes.length*size);tensors.forEach((t,i)=>data.set(t.data,i*size));
   const chars=await this.loadCharacters(),output=await this.infer('rec',{data,dims:[rowBoxes.length,3,48,320]});
   if(output.dims.length!==3||output.dims[0]!==rowBoxes.length||output.dims[2]!==chars.length)throw Error('Paddle row batch output shape mismatch');
   const steps=output.dims[1],classes=output.dims[2],lines=rowBoxes.map((b,i)=>{
    const decoded=decodeCtc(output.data.subarray(i*steps*classes,(i+1)*steps*classes),steps,classes,chars);
    return lineResult(decoded,[[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1]],steps*tensors[i].contentWidth/320);
   });
   return {text:lines.map(l=>l.text).join('\n').trim(),confidence:lines.reduce((s,l)=>s+l.confidence,0)/lines.length,lines,emptyRows:lines.filter(l=>!l.text).length,detectorCalls:0,recognitionBatches:1,workerMs:performance.now()-start};
  }
  const global=preprocessGlobal(original),chars=await this.loadCharacters();
  if(path==='line'){
   const quad=[[0,0],[original.width,0],[original.width,original.height],[0,original.height]];
   const vertical=['ja','zh'].includes(this.sourceLanguage)&&global.image.height/global.image.width>=1.5;
   const crop=vertical?perspectiveCrop(global.image,[[0,0],[global.image.width,0],[global.image.width,global.image.height],[0,global.image.height]]):{image:global.image,rotated:false};
   const input=recognitionTensor(crop.image),output=await this.infer('rec',input),decoded=decodeCtc(output.data,output.dims[1],output.dims[2],chars);
   const line=lineResult(decoded,quad,output.dims[1]*input.contentWidth/input.dims[3],crop.rotated);
   return {text:line.text,confidence:line.confidence,lines:[line],writingMode:vertical?'vertical-rl':'horizontal-tb',workerMs:performance.now()-start};
  }
  const padded=verticalPadding(global.image),image=padded.image,ratio=path==='fast-block'?256/Math.min(image.width,image.height):Math.max(1,736/Math.min(image.width,image.height)),w=bankersRound(Math.floor(image.width*ratio)/32)*32,h=bankersRound(Math.floor(image.height*ratio)/32)*32;
  if(w*h>8000000)throw Error('Paddle detection tensor exceeds the bounded crop budget');
  const input=bgrTensor(image,w,h),output=await this.infer('det',input),boxes=decodeDetection(output.data,output.dims[3],output.dims[2],image.width,image.height),lines=[];
  for(const box of boxes){
   const crop=perspectiveCrop(image,box.quad),tensor=recognitionTensor(crop.image),rec=await this.infer('rec',tensor),decoded=decodeCtc(rec.data,rec.dims[1],rec.dims[2],chars);
   const quad=box.quad.map(([x,y])=>[Math.max(0,Math.min(original.width,x*global.scaleX)),Math.max(0,Math.min(original.height,(y-padded.top)*global.scaleY))]);
   lines.push(lineResult(decoded,quad,rec.dims[1]*tensor.contentWidth/tensor.dims[3],crop.rotated));
  }
  const vertical=['ja','zh'].includes(this.sourceLanguage)&&(original.height/original.width>=1.5||boxes.filter(box=>{
   const xs=box.quad.map(p=>p[0]),ys=box.quad.map(p=>p[1]);return Math.max(...ys)-Math.min(...ys)>1.5*(Math.max(...xs)-Math.min(...xs));
  }).length>boxes.length/2);
  const ordering={sourceLanguage:this.sourceLanguage,writingMode:vertical?'vertical-rl':'horizontal-tb'};
  const ordered=path==='fast-block'?orderPaddleLines(lines,ordering):lines;
  const text=joinPaddleLines(ordered,ordering).trim(),confidence=lines.length?lines.reduce((s,l)=>s+l.confidence,0)/lines.length:0;
  return {text,confidence,lines:ordered,writingMode:ordering.writingMode,workerMs:performance.now()-start,detectedLines:boxes.length};
 }
 async recognize(imageDataUrl,path,rowBoxes){
  const image=await createImageBitmap(await(await fetch(imageDataUrl)).blob());
  try{const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
   const pixels=ctx.getImageData(0,0,image.width,image.height);canvas.width=canvas.height=1;return await this.recognizePixels(pixels,path,rowBoxes);
  }finally{image.close();}
 }
 async release(){this.closed=true;await Promise.allSettled([...this.sessions.values()].map(async p=>(await p).release()));this.sessions.clear();}
}
