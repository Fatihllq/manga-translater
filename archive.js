import {zipSync,strFromU8} from './vendor/fflate.js';
import './bounded-response.js';

const MAX_INPUT=128*1024*1024,MAX_TOTAL=256*1024*1024,MAX_IMAGE=40*1024*1024,MAX_FILES=500;
const imageName=/\.(png|jpe?g|webp)$/i,archiveName=/\.(zip|cbz)$/i;
const collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
function safeName(name){
 if(typeof name!=='string'||!name||name.length>1024||/[\0-\x1f]/.test(name))throw Error('Geçersiz dosya adı.');
 const normalized=name.replace(/\\/g,'/');
 if(normalized.startsWith('/')||/^[a-z]:/i.test(normalized)||normalized.split('/').some(part=>part==='..'||part==='.'||part===''))throw Error('Arşiv güvenli olmayan bir dosya yolu içeriyor.');
 return normalized;
}
const crcTable=Uint32Array.from({length:256},(_,value)=>{
 for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;
});
function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
function zipIndex(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
 if(end<0)throw Error('ZIP dizini bulunamadı veya arşiv eksik.');
 const count=view.getUint16(end+10,true),length=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
 if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||view.getUint16(end+8,true)!==count||count===65535||count>5000||offset===0xffffffff||offset+length!==end)throw Error('Çok parçalı, ZIP64 veya aşırı büyük arşiv desteklenmiyor.');
 const images=new Map(),names=new Set();let position=offset,total=0;
 for(let i=0;i<count;i++){
  if(position+46>end||view.getUint32(position,true)!==0x02014b50)throw Error('ZIP dizini bozuk.');
  const flags=view.getUint16(position+8,true),method=view.getUint16(position+10,true),checksum=view.getUint32(position+16,true),compressed=view.getUint32(position+20,true),original=view.getUint32(position+24,true);
  const nameLength=view.getUint16(position+28,true),extra=view.getUint16(position+30,true),comment=view.getUint16(position+32,true),next=position+46+nameLength+extra+comment;
  if(next>end)throw Error('ZIP dosya kaydı eksik.');
  const name=strFromU8(bytes.subarray(position+46,position+46+nameLength),!(flags&2048));
  if(!name.endsWith('/')){
   const clean=safeName(name),canonical=clean.normalize('NFC').toLowerCase();
   if(names.has(canonical))throw Error('Arşiv yinelenen dosya adları içeriyor.');names.add(canonical);
   if(flags&1||![0,8].includes(method))throw Error('Şifreli veya desteklenmeyen ZIP sıkıştırması.');
   if(imageName.test(clean)){
    total+=original;
    if(!original||original>MAX_IMAGE||total>MAX_TOTAL||images.size>=MAX_FILES||original>Math.max(1,compressed)*250)throw Error('Arşivin açılmış boyutu veya dosya sayısı güvenli sınırı aşıyor.');
    const local=view.getUint32(position+42,true);
    if(local+30>offset||view.getUint32(local,true)!==0x04034b50||view.getUint16(local+6,true)!==flags||view.getUint16(local+8,true)!==method)throw Error('ZIP yerel dosya kaydı geçersiz.');
    const localNameLength=view.getUint16(local+26,true),start=local+30+localNameLength+view.getUint16(local+28,true);
    if(start+compressed>offset||strFromU8(bytes.subarray(local+30,local+30+localNameLength),!(flags&2048))!==name)throw Error('ZIP dosya yolu veya boyutu geçersiz.');
    if(!(flags&8)&&(view.getUint32(local+14,true)!==checksum||view.getUint32(local+18,true)!==compressed||view.getUint32(local+22,true)!==original))throw Error('ZIP dosyasının sağlamlık kontrolü başarısız: '+clean);
    images.set(name,{name:clean,checksum,original,compressed,method,start});
   }
  }else safeName(name.slice(0,-1));
  position=next;
 }
 if(position!==end)throw Error('ZIP dizin uzunluğu geçersiz.');
 return images;
}
export function imageInfo(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),ascii=(start,length)=>String.fromCharCode(...bytes.subarray(start,start+length));let width,height,type,extension;
 if(bytes.length>=24&&bytes[0]===137&&ascii(1,3)==='PNG'&&ascii(12,4)==='IHDR'){
  width=view.getUint32(16);height=view.getUint32(20);type='image/png';extension='png';
 }else if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216){
  let position=2;
  while(position+4<=bytes.length){
   if(bytes[position++]!==255)throw Error('JPEG yapısı geçersiz.');while(bytes[position]===255)position++;
   const marker=bytes[position++];if(marker===217||marker===218)break;
   if(marker===1||marker>=208&&marker<=215)continue;
   if(position+2>bytes.length)break;const length=view.getUint16(position);
   if(length<2||position+length>bytes.length)throw Error('JPEG dosyası eksik.');
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7){height=view.getUint16(position+3);width=view.getUint16(position+5);break;}position+=length;
  }
  type='image/jpeg';extension='jpg';
 }else if(bytes.length>=30&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'){
  const format=ascii(12,4);
  if(format==='VP8X'){width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16);}
  else if(format==='VP8 '&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=view.getUint16(26,true)&16383;height=view.getUint16(28,true)&16383;}
  else if(format==='VP8L'&&bytes[20]===47){const bits=view.getUint32(21,true);width=(bits&16383)+1;height=(bits>>>14&16383)+1;}
  type='image/webp';extension='webp';
 }
 if(!width||!height||width>32767||height>32767||width*height>100000000)throw Error('Görsel biçimi veya piksel boyutu desteklenmiyor (PNG/JPEG/WebP, en çok 100 megapiksel).');
 return {width,height,type,extension};
}
export async function readLocalFiles(fileList){
 const files=Array.from(fileList??[]);if(!files.length)throw Error('Önce görsel veya ZIP/CBZ dosyası seç.');
 if(files.length>MAX_FILES||files.reduce((sum,file)=>sum+file.size,0)>MAX_INPUT)throw Error('Seçim en çok 500 dosya ve 128 MiB olabilir.');
 const result=[];let total=0;
 const add=(name,bytes)=>{
  total+=bytes.byteLength;if(bytes.byteLength>MAX_IMAGE||total>MAX_TOTAL||result.length>=MAX_FILES)throw Error('Açılmış görseller toplam 256 MiB sınırını aşıyor.');
  const info=imageInfo(bytes);result.push({name:safeName(name),blob:new Blob([bytes],{type:info.type})});
 };
 for(const file of files){
  const name=safeName(file.name),bytes=new Uint8Array(await file.arrayBuffer());
  if(archiveName.test(name)){
   const index=zipIndex(bytes);
   for(const info of index.values()){
    if(total+info.original>MAX_TOTAL||result.length>=MAX_FILES)throw Error('Açılmış görseller toplam 256 MiB sınırını aşıyor.');
    let data=bytes.subarray(info.start,info.start+info.compressed);
    if(info.method===8){
     // Small input chunks bound the work before the output-size check can cancel.
     let position=0;const packed=data;
     const stream=new ReadableStream({pull(controller){
      if(position===packed.length){controller.close();return;}
      const end=Math.min(position+1024,packed.length);controller.enqueue(packed.subarray(position,end));position=end;
     }}).pipeThrough(new DecompressionStream('deflate-raw'));
     try{data=new Uint8Array(await(await globalThis.__mangaReadBoundedBlob(new Response(stream),info.original,'Arşiv boyutu güvenli sınırı aşıyor.')).arrayBuffer());}
     catch(error){if(error.name==='QuotaExceededError')throw error;throw Error('ZIP dosyasının sağlamlık kontrolü başarısız: '+info.name,{cause:error});}
    }
    if(data.length!==info.original||crc32(data)!==info.checksum)throw Error('ZIP dosyasının sağlamlık kontrolü başarısız: '+info.name);
    add(name.replace(/\.(zip|cbz)$/i,'')+'/'+info.name,data);
   }
  }else if(imageName.test(name))add(name,bytes);
  else throw Error('Yalnız PNG, JPEG, WebP, ZIP veya CBZ açılabilir.');
 }
 if(!result.length)throw Error('Arşivde desteklenen görsel bulunamadı.');
 return result.sort((a,b)=>collator.compare(a.name,b.name));
}
export async function createArchive(pages){
 if(!Array.isArray(pages)||!pages.length||pages.length>MAX_FILES)throw Error('ZIP için 1–500 sayfa seç.');
 const entries=Object.create(null);let total=0;
 for(const [index,page]of pages.entries()){
  if(!(page.blob instanceof Blob))throw Error('Geçersiz çıktı görseli.');
  total+=page.blob.size;if(total>MAX_TOTAL||page.blob.size>MAX_IMAGE)throw Error('ZIP çıktı boyutu güvenli sınırı aşıyor.');
  const bytes=new Uint8Array(await page.blob.arrayBuffer()),info=imageInfo(bytes),base=safeName(page.name??'sayfa').split('/').at(-1).replace(/\.[^.]+$/,'');
  entries[String(index+1).padStart(4,'0')+'-'+base+'.'+info.extension]=[bytes,{level:0}];
 }
 return new Blob([zipSync(entries)],{type:'application/zip'});
}
export function downloadBlob(blob,name){
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
