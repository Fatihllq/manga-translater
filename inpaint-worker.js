let runtime,session;
self.onmessage=async({data})=>{
 const {id,image,mask,width,height,threads}=data;let inputs,outputs;
 try{
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4000000||image?.length!==width*height*3||mask?.length!==width*height)throw Error('Geçersiz temizleme girdisi.');
  if(!runtime){runtime=await import('./vendor/onnx/ort.wasm.min.mjs');runtime.env.wasm.wasmPaths=new URL('./vendor/onnx/',import.meta.url).href;runtime.env.wasm.numThreads=globalThis.crossOriginIsolated?Math.min(2,threads||1):1;}
  session??=await runtime.InferenceSession.create(new URL('./vendor/inpainting/migan_pipeline_v2.onnx',import.meta.url).href,{executionProviders:['wasm']});
  inputs={image:new runtime.Tensor('uint8',image,[1,3,height,width]),mask:new runtime.Tensor('uint8',mask,[1,1,height,width])};
  outputs=await session.run(inputs);const output=outputs[session.outputNames[0]];
  if(output.type!=='uint8'||output.data.length!==image.length)throw Error('Temizleme çıktısı geçersiz.');
  const result=Uint8Array.from(output.data);self.postMessage({id,result},[result.buffer]);
 }catch(error){self.postMessage({id,error:error.message});}
 finally{for(const t of Object.values(inputs??{}))t.dispose();for(const t of Object.values(outputs??{}))t.dispose();}
};
