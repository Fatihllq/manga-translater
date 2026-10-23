import './text-layout.js';
import {dilate} from './pixel-masks.js';
export const inplaceGeometry=globalThis.__mangaTextLayout.inplaceGeometry;
export function maskPixels(region,width,height){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>4000000)throw Error('Temizleme alanı bellek sınırını aşıyor.');
 const mask=new Uint8Array(width*height),lines=region.ocr?.lines??[];
 const polygons=region.erasePolygons?[...region.erasePolygons]:lines.flatMap(l=>[l,...(l.words??[])].map(w=>w.polygon??(w.bbox?[[w.bbox.x0,w.bbox.y0],[w.bbox.x1,w.bbox.y0],[w.bbox.x1,w.bbox.y1],[w.bbox.x0,w.bbox.y1]]:null)).filter(Boolean));
 if(!polygons.length){for(const b of region.eraseBoxes??[])polygons.push([[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1]]);}
 if(!polygons.length)polygons.push([[2,2],[width-2,2],[width-2,height-2],[2,height-2]]);
 const origin=region.crop?.sourceBounds??region.ocrBounds??region.bounds;
 if(origin&&region.textBounds){const b=region.textBounds,sx=width/origin.width,sy=height/origin.height;polygons.push([[b.x-origin.x,b.y-origin.y],[b.x+b.width-origin.x,b.y-origin.y],[b.x+b.width-origin.x,b.y+b.height-origin.y],[b.x-origin.x,b.y+b.height-origin.y]].map(([x,y])=>[x*sx,y*sy]));}
 if(polygons.length>10000)throw Error('Çok fazla temizleme poligonu.');
 for(const points of polygons){
  if(!Array.isArray(points)||points.length<3||points.length>100||points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))throw Error('Temizleme poligonu geçersiz.');
  const x0=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0])))),x1=Math.min(width,Math.ceil(Math.max(...points.map(p=>p[0]))));
  const y0=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1])))),y1=Math.min(height,Math.ceil(Math.max(...points.map(p=>p[1]))));
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
   const a=points[i],b=points[j];if((a[1]>y+.5)!==(b[1]>y+.5)&&x+.5<(b[0]-a[0])*(y+.5-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }if(inside)mask[y*width+x]=1;}
 }
 const expanded=dilate(mask,width,height,2);return Uint8Array.from(expanded,v=>v?0:255);
}
