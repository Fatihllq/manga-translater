import {clampBounds,intersection,area} from './detection-geometry.js';
export const DISPLAY_GEOMETRY_VERSION='balloon-interior-v2';
// This is presentation metadata. Detection regions and OCR crops remain intact.
export function largestInteriorRectangle(mask,width,height) {
 const heights=new Int32Array(width);let best={x:0,y:0,width:0,height:0};
 for(let y=0;y<height;y++){
  for(let x=0;x<width;x++)heights[x]=mask[y*width+x]?heights[x]+1:0;
  const stack=[];
  for(let x=0;x<=width;x++){
   const h=x===width?0:heights[x];let start=x;
   while(stack.length&&stack.at(-1).h>h){const top=stack.pop(),w=x-top.x;if(w*top.h>best.width*best.height)best={x:top.x,y:y-top.h+1,width:w,height:top.h};start=top.x;}
   if(h&&(!stack.length||stack.at(-1).h<h))stack.push({x:start,h});
  }
 }
 return best;
}
export function findInterior(pixels,width,height,text,knownText=[],separateText=[]) {
 if(![text.x,text.y,text.width,text.height].every(Number.isFinite)||text.width<=0||text.height<=0||text.x<0||text.y<0||text.x+text.width>width||text.y+text.height>height)return null;
 const samples=[];
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){
  const px=Math.max(0,Math.min(width-1,Math.floor(text.x+(x+.5)*text.width/8)));
  const py=Math.max(0,Math.min(height-1,Math.floor(text.y+(y+.5)*text.height/8))),i=(py*width+px)*4;
  samples.push({index:py*width+px,r:pixels[i],g:pixels[i+1],b:pixels[i+2],key:[pixels[i]>>5,pixels[i+1]>>5,pixels[i+2]>>5].join(':')});
 }
 const buckets=new Map();for(const p of samples)buckets.set(p.key,(buckets.get(p.key)||0)+1);
 const dominant=[...buckets].sort((a,b)=>b[1]-a[1])[0];if(!dominant||dominant[1]<samples.length*.35)return null;
 const group=samples.filter(p=>p.key===dominant[0]),median=k=>group.map(p=>p[k]).sort((a,b)=>a-b)[Math.floor(group.length/2)],color=[median('r'),median('g'),median('b')];
 const distance=p=>Math.abs(p.r-color[0])+Math.abs(p.g-color[1])+Math.abs(p.b-color[2]);
 const variation=group.map(distance).sort((a,b)=>a-b)[Math.floor((group.length-1)*.9)];
 // A flat white ground must not swallow a faint grey balloon outline.
 const tolerance=Math.max(9,Math.min(65,variation+9));
 const match=i=>Math.abs(pixels[i*4]-color[0])+Math.abs(pixels[i*4+1]-color[1])+Math.abs(pixels[i*4+2]-color[2])<tolerance;
 const n=width*height,background=new Uint8Array(n),visited=new Uint8Array(n),queue=new Int32Array(n);
 const cx=text.x+text.width/2,cy=text.y+text.height/2;
 const neighbours=(i,visit)=>{const x=i%width;if(x)visit(i-1);if(x+1<width)visit(i+1);if(i>=width)visit(i-width);if(i+width<n)visit(i+width);};
 let head=0,tail=0,component;
 // A sample can land inside O/A. Prefer the enclosed ground around the letters.
 for(const {index:seed}of group){
  if(visited[seed]||!match(seed))continue;
  head=0;tail=1;let edge=false;queue[0]=seed;visited[seed]=1;
  while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width);if(!x||!y||x===width-1||y===height-1)edge=true;
   neighbours(i,j=>{if(!visited[j]&&match(j)){visited[j]=1;queue[tail++]=j;}});}
  if(!edge&&tail>=24&&tail>(component?.length??0))component=queue.slice(0,tail);
 }
 if(!component)return null;
 for(const i of component)background[i]=1;
 const outside=new Uint8Array(n);head=0;tail=0;
 const push=i=>{if(!background[i]&&!outside[i]){outside[i]=1;queue[tail++]=i;}};
 for(let x=0;x<width;x++){push(x);push((height-1)*width+x);}for(let y=1;y<height-1;y++){push(y*width);push(y*width+width-1);}
 while(head<tail)neighbours(queue[head++],push);
 const mask=new Uint8Array(n);
 for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
  const i=y*width+x;
  // Inset one analysis pixel: excludes the balloon outline and its antialiasing.
  if(!outside[i]&&!outside[i-1]&&!outside[i+1]&&!outside[i-width]&&!outside[i+width])mask[i]=1;
 }
 const centerIndex=Math.max(0,Math.min(n-1,Math.floor(cy)*width+Math.floor(cx)));
 if(!mask[centerIndex])return null;
 let covered=0,total=0,ink=0,externalInk=0;
 const padding=Math.max(2,Math.min(text.width,text.height)*.12);
 const contained=b=>{
  if(!b||![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0||b.x<0||b.y<0||b.x+b.width>width||b.y+b.height>height)return false;
  let count=0,inside=0;
  for(let y=Math.floor(b.y);y<Math.ceil(b.y+b.height);y++)for(let x=Math.floor(b.x);x<Math.ceil(b.x+b.width);x++){count++;inside+=mask[y*width+x];}
  return count>0&&inside/count>=.92;
 };
 const trusted=[text,...knownText.filter(contained)];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask[y*width+x]&&!background[y*width+x]){
  ink++;if(!trusted.some(b=>x>=b.x-padding&&x<=b.x+b.width+padding&&y>=b.y-padding&&y<=b.y+b.height+padding))externalInk++;
 }
 if(externalInk>ink*.15&&externalInk>text.width*text.height*.015)return null;
 for(let y=Math.max(0,Math.floor(text.y));y<Math.min(height,Math.ceil(text.y+text.height));y++)for(let x=Math.max(0,Math.floor(text.x));x<Math.min(width,Math.ceil(text.x+text.width));x++){
  total++;covered+=mask[y*width+x];
 }
 // A closed patch near the words is insufficient: it must contain the text.
 if(!total||covered/total<.92)return null;
 // Separate translated groups share the enclosure, not the same writing area.
 for(const b of separateText.filter(contained)){
  const dx=b.x+b.width/2-cx,dy=b.y+b.height/2-cy;
  const apartX=b.x>=text.x+text.width||b.x+b.width<=text.x;
  const apartY=b.y>=text.y+text.height||b.y+b.height<=text.y;
  if(!apartX&&!apartY)continue;
  const horizontal=apartX&&(!apartY||Math.abs(dx)/Math.max(text.width,b.width)>Math.abs(dy)/Math.max(text.height,b.height));
  const boundary=horizontal?(dx>0?(text.x+text.width+b.x)/2:(b.x+b.width+text.x)/2):(dy>0?(text.y+text.height+b.y)/2:(b.y+b.height+text.y)/2);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(horizontal?(dx>0?x>=boundary:x<boundary):(dy>0?y>=boundary:y<boundary))mask[y*width+x]=0;
 }
 const bounds=largestInteriorRectangle(mask,width,height);if(bounds.width<4||bounds.height<4)return null;
 return {mask,bounds,color};
}
function maskPath(mask,w,h,roi,sx,sy) {
 const complete=[],open=new Map();
 for(let y=0;y<=h;y++){
  const row=new Map();
  if(y<h)for(let x=0;x<w;){if(!mask[y*w+x]){x++;continue;}const left=x;while(x<w&&mask[y*w+x])x++;row.set(left+':'+x,{left,right:x});}
  for(const[key,r]of open)if(!row.has(key)){complete.push(r);open.delete(key);}
  for(const[key,r]of row){if(open.has(key))open.get(key).bottom=y+1;else open.set(key,{...r,top:y,bottom:y+1});}
 }
 const num=n=>Number(n.toFixed(3));
 return complete.map(r=>'M'+num(roi.x+r.left/sx)+' '+num(roi.y+r.top/sy)+'h'+num((r.right-r.left)/sx)+'v'+num((r.bottom-r.top)/sy)+'h-'+num((r.right-r.left)/sx)+'Z').join('');
}
export function addDisplayGeometry(regions,image,raw=[]) {
 const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;
 const bubbles=raw.filter(b=>b.label===0);
 const canvas=new OffscreenCanvas(1,1),ctx=canvas.getContext('2d',{willReadFrequently:true}),cache=new Map();
 return regions.map(region=>{
  const text=region.textBounds??region.bounds;
  const peers=regions.filter(r=>r!==region&&r.kind!=='free'&&!r.fallback);
  const known=[...(region.textParts??[]),...peers.flatMap(r=>r.textParts??[r.textBounds??r.bounds]),...raw.filter(b=>b.label===1&&b.score>=.72)];
  const candidates=[region.bubbleBounds,...bubbles].filter(b=>b&&intersection(b,text)/Math.max(1,area(text))>=.85).sort((a,b)=>area(a)-area(b));
  // Missing or incorrect detector matches still get the same closed-area search.
  for(const factor of [.6,1.2,2])candidates.push({x:text.x-text.width*factor,y:text.y-text.height*factor,width:text.width*(1+2*factor),height:text.height*(1+2*factor)});
  let geometry={version:DISPLAY_GEOMETRY_VERSION,mode:'unavailable'};
  for(const bb of candidates){
  const key=[bb.x,bb.y,bb.width,bb.height,text.x,text.y,text.width,text.height].join(':');
  if(cache.has(key)){geometry=cache.get(key);if(geometry.mode==='inside')break;continue;}
  const margin=Math.max(12,Math.min(64,Math.max(bb.width,bb.height)*.15));
  const roi=clampBounds({x:Math.floor(bb.x-margin),y:Math.floor(bb.y-margin),width:Math.ceil(bb.width+2*margin),height:Math.ceil(bb.height+2*margin)},width,height);
  const scale=Math.min(1,512/Math.max(roi.width,roi.height));
  canvas.width=Math.max(1,Math.ceil(roi.width*scale));canvas.height=Math.max(1,Math.ceil(roi.height*scale));
  const sx=canvas.width/roi.width,sy=canvas.height/roi.height;
  ctx.drawImage(image,roi.x,roi.y,roi.width,roi.height,0,0,canvas.width,canvas.height);
  const local=b=>({x:(b.x-roi.x)*sx,y:(b.y-roi.y)*sy,width:b.width*sx,height:b.height*sy});
  const interior=findInterior(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,
   local(text),known.map(local),known.map(local));
  if(interior){
   const c=interior.color,bands=[];
   for(let y=0;y<canvas.height;y++){let left=canvas.width,right=-1;for(let x=0;x<canvas.width;x++)if(interior.mask[y*canvas.width+x]){left=Math.min(left,x);right=x;}
    if(right>=left)bands.push({x:roi.x+left/sx,y:roi.y+y/sy,width:(right-left+1)/sx,height:1/sy});}
   const b={x:(Math.min(...bands.map(b=>b.x))-roi.x)*sx,y:(bands[0].y-roi.y)*sy,width:(Math.max(...bands.map(b=>b.x+b.width))-Math.min(...bands.map(b=>b.x)))*sx,height:bands.length/sy*sy};
   geometry={version:DISPLAY_GEOMETRY_VERSION,mode:'inside',bounds:{x:roi.x+b.x/sx,y:roi.y+b.y/sy,width:b.width/sx,height:b.height/sy},
    bands,clipPath:maskPath(interior.mask,canvas.width,canvas.height,roi,sx,sy),background:'rgb('+c.join(',')+')',textColor:(c[0]*299+c[1]*587+c[2]*114)/1000<145?'#fff':'#171717'};
  }
  cache.set(key,geometry);if(geometry.mode==='inside')break;
  }
  return {...region,displayGeometry:geometry};
 });
}
