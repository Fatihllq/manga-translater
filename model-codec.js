const LIMIT=24*1024*1024;
const files=new Set(['detector-worker.js','paddle-worker.js','inpaint-worker.js']);
export const allowedModelFile=file=>files.has(file);
export function allowedModelSender(sender,id){try{const url=new URL(sender?.url);return sender.id===id&&url.protocol==='chrome-extension:'&&url.host===id&&url.pathname==='/panel.html';}catch{return false;}}
export async function encodeModelData(value,budget={bytes:0}){
 if(value instanceof Blob||ArrayBuffer.isView(value)||value instanceof ArrayBuffer){
  const kind=value instanceof Blob?'Blob':value instanceof Uint8ClampedArray?'Uint8ClampedArray':value instanceof Uint8Array?'Uint8Array':value instanceof ArrayBuffer?'ArrayBuffer':null;
  if(!kind)throw Error('Unsupported model binary type');const size=value.size??value.byteLength;budget.bytes+=size;if(budget.bytes>LIMIT)throw Error('Model message binary limit exceeded');
  const bytes=value instanceof Blob?new Uint8Array(await value.arrayBuffer()):value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return {__modelBinary:kind,data:btoa(binary),mime:value.type};
 }
 if(Array.isArray(value))return Promise.all(value.map(v=>encodeModelData(v,budget)));
 if(value&&typeof value==='object'){const result={};for(const [key,v]of Object.entries(value))if(v!==undefined)result[key]=await encodeModelData(v,budget);return result;}
 return value;
}
export function decodeModelData(value,budget={bytes:0}){
 if(value?.__modelBinary){const kind=value.__modelBinary;if(!['Blob','Uint8Array','Uint8ClampedArray','ArrayBuffer'].includes(kind)||typeof value.data!=='string'||value.data.length>LIMIT*4/3+4)throw Error('Invalid model binary message');
  const raw=atob(value.data);budget.bytes+=raw.length;if(budget.bytes>LIMIT)throw Error('Model message binary limit exceeded');const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  return kind==='Blob'?new Blob([bytes],{type:typeof value.mime==='string'?value.mime:''}):kind==='ArrayBuffer'?bytes.buffer:kind==='Uint8ClampedArray'?new Uint8ClampedArray(bytes.buffer):bytes;
 }
 if(Array.isArray(value))return value.map(v=>decodeModelData(v,budget));
 if(value&&typeof value==='object'){const result={};for(const [k,v]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(k))throw Error('Invalid model key');result[k]=decodeModelData(v,budget);}return result;}
 return value;
}
