(() => {
 if(globalThis.__mangaReadBoundedBlob)return;
 globalThis.__mangaReadBoundedBlob=async(response,limit=80_000_000,message='Görsel dosyası çok büyük.')=>{
  const tooLarge=()=>new DOMException(message,'QuotaExceededError');
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel().catch(()=>{});throw tooLarge();}
  const reader=response.body?.getReader(),chunks=[];let size=0;
  if(reader)try{
   while(true){
    const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;if(size>limit)throw tooLarge();chunks.push(value);
   }
  }catch(error){await reader.cancel(error).catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  return new Blob(chunks,{type:response.headers.get('content-type')||''});
 };
})();
