import './text-layout.js';
import {drawingCommands,drawCommands} from './drawing-edits.js';
import {prepareRegion} from './inpaint-client.js';
const layout=globalThis.__mangaTextLayout,MAX_PIXELS=64000000;
const textOf=r=>String(r.targetText??r.turkish??r.text??'').trim();
function clip(context,g){context.beginPath();if(g.clipPath&&layout.safeMask(g.clipPath))context.clip(new Path2D(g.clipPath));else{const b=g.bounds;context.rect(b.x,b.y,b.width,b.height);context.clip();}}
function drawText(context,text,bounds,fit,style,color,direction,appearance={},angle=0){
 const position=layout.textPosition(bounds,fit,style.align);context.save();
 if(angle){context.translate(bounds.x+bounds.width/2,bounds.y+bounds.height/2);context.rotate(angle*Math.PI/180);context.translate(-bounds.x-bounds.width/2,-bounds.y-bounds.height/2);}
 context.font=layout.fontCss(style,fit.fontSize);context.textBaseline='alphabetic';context.textAlign=style.align;context.direction=direction==='rtl'?'rtl':'ltr';context.fillStyle=style.color??layout.safeColor(appearance.color??color,'#171717');
 context.strokeStyle=layout.safeColor(appearance.strokeColor,'#fff');context.lineWidth=fit.fontSize*.08;context.lineJoin='round';
 fit.lines.forEach((line,i)=>{const x=line.x??position.x,y=line.y??position.top+fit.fontSize*.83+i*fit.lineHeight;if(appearance.outlined)context.strokeText(line.text,x,y);context.fillText(line.text,x,y);});context.restore();
}
async function sourceBitmap(source){
 if(typeof source==='string'){if(!/^data:image\/(?:png|jpeg|webp|gif|bmp);base64,/i.test(source))throw Error('PNG çıktısı için yerel bir görsel seç.');source=await(await fetch(source)).blob();}
 if(!(source instanceof Blob)||!source.type.startsWith('image/'))throw Error('PNG çıktısının kaynağı bir görsel olmalı.');
 if(source.size>100*1024*1024)throw Error('Kaynak görsel 100 MiB sınırını aşıyor.');return createImageBitmap(source);
}
async function cleanup(region,image,signal){
 if(region.cleanupPatch)return;
 const b=region.ocrBounds??region.bounds,x=Math.max(0,Math.floor(b.x)),y=Math.max(0,Math.floor(b.y)),width=Math.min(image.width-x,Math.ceil(b.width)),height=Math.min(image.height-y,Math.ceil(b.height));
 if(width<1||height<1)throw Error('Yazı alanı görselin dışında.');
 const canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d');context.drawImage(image,x,y,width,height,0,0,width,height);
 const blob=await canvas.convertToBlob({type:'image/png'}),data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
 await prepareRegion(region,{imageDataUrl:data,width,height,sourceBounds:{x,y,width,height},background:{color:region.background??region.displayGeometry?.background??'#fff',textColor:region.textColor,flatForAutomatic:region.flat===true}},{signal});
}
export async function renderPage(source,regions,options={}){
 if(!Array.isArray(regions)||regions.length>1000)throw Error('Sayfadaki çeviri alanları geçersiz.');
 const image=await sourceBitmap(source);
 try{
  if(image.width*image.height>MAX_PIXELS||image.width>65535||image.height>65535)throw Error('Görsel PNG oluşturma bellek sınırını aşıyor; özgün görsel korundu.');
  await layout.prepareFonts(new URL('./assets/fonts/NotoSans.ttf',import.meta.url));await globalThis.document?.fonts?.ready;
  const canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);
  for(const region of regions){
   if(!region||region.hidden||region.selected===false)continue;
   const text=textOf(region);if(!text&&!region.drawingEdits?.length)continue;if(text.length>20000)throw Error('Tek alanın çevirisi 20.000 karakteri aşıyor.');
   if(text)await cleanup(region,image,options.signal);
   const geometry=layout.inplaceGeometry(region,image.width,image.height),style=layout.resolvedTextStyle({...options.style,...region.textStyle},region.appearance),bounds=geometry.textBounds??geometry.bounds;
   context.save();clip(context,geometry);
   if(text){
    const commands=layout.paintCommands(region,geometry,true).commands;
    for(const command of commands){if(command.type==='image'){const bitmap=await createImageBitmap(await(await fetch(command.dataUrl)).blob());try{context.drawImage(bitmap,command.x,command.y,command.width,command.height);}finally{bitmap.close();}}else drawCommands(context,[command]);}
   }
   if(region.drawingEdits?.length)drawCommands(context,drawingCommands(region.drawingEdits,region.bounds,geometry.background));
   if(text){const metric=(t,size)=>{context.font=layout.fontCss(style,size);return context.measureText(t).width;};const saved=region.renderLayout;const reusable=saved&&JSON.stringify(region.renderStyle)===JSON.stringify(style)&&saved.text?.replace(/\s/g,'')===text.replace(/\s/g,'')&&Array.isArray(saved.lines)&&saved.lines.length>0&&[saved.fontSize,saved.height,saved.lineHeight].every(n=>Number.isFinite(n)&&n>0)&&saved.height<=bounds.height+.1&&saved.lines.every(l=>typeof l.text==='string'&&Number.isFinite(l.width)&&l.width<=bounds.width+.1);const fit=reusable?saved:layout.fitRegionText(text,bounds,metric,style,options.displayScale??1,geometry.bands,region.appearance?.fontSize);if(!fit)throw Error('Çeviri alanına yerleştirilemedi.');
    drawText(context,text,bounds,fit,style,geometry.textColor,region.targetDirection,region.appearance,geometry.angle);
   }
   context.restore();
  }
  return await canvas.convertToBlob({type:'image/png'});
 }finally{image.close();}
}
