import {clampBounds,unionBounds} from './detection-geometry.js';
export const REFINEMENT_VERSION='closed-color-v1';
function rgbDistance(pixels,index,color) {
  const offset=index*4;return Math.abs(pixels[offset]-color[0])+Math.abs(pixels[offset+1]-color[1])+Math.abs(pixels[offset+2]-color[2]);
}
// Enclosed foreground holes in one connected background component are glyph
// candidates. The outer outline and nearby artwork connect to the ROI edges.
export function enclosedInk(pixels,width,height,seeds,color) {
  const n=width*height,background=new Uint8Array(n),queue=new Int32Array(n);
  let head=0,tail=0;
  const neighbours=(index,visit)=>{
    const x=index%width,y=Math.floor(index/width);
    if(x>0)visit(index-1);if(x<width-1)visit(index+1);
    if(y>0)visit(index-width);if(y<height-1)visit(index+width);
  };
  const start=seeds.find(i=>i>=0&&i<n&&rgbDistance(pixels,i,color)<65);
  if(start===undefined)return null;
  background[start]=1;queue[tail++]=start;
  let minX=width,minY=height,maxX=0,maxY=0,touchesEdge=false;
  while(head<tail){
    const index=queue[head++],x=index%width,y=Math.floor(index/width);
    minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
    if(x===0||y===0||x===width-1||y===height-1)touchesEdge=true;
    neighbours(index,next=>{if(!background[next]&&rgbDistance(pixels,next,color)<65){background[next]=1;queue[tail++]=next;}});
  }
  if(touchesEdge || tail<100)return null;
  const componentArea=tail,componentBounds={x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1};
  const outside=new Uint8Array(n);head=0;tail=0;
  const seedOutside=index=>{if(!background[index]&&!outside[index]){outside[index]=1;queue[tail++]=index;}};
  for(let x=0;x<width;x++){seedOutside(x);seedOutside((height-1)*width+x);}
  for(let y=1;y<height-1;y++){seedOutside(y*width);seedOutside(y*width+width-1);}
  while(head<tail){const index=queue[head++];neighbours(index,next=>seedOutside(next));}
  const visited=new Uint8Array(n),holes=[];
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    const index=y*width+x;if(background[index]||outside[index]||visited[index])continue;
    head=0;tail=0;queue[tail++]=index;visited[index]=1;
    let x0=width,y0=height,x1=0,y1=0,ink=0;
    while(head<tail){
      const current=queue[head++],cx=current%width,cy=Math.floor(current/width);
      if(rgbDistance(pixels,current,color)>=65){ink++;x0=Math.min(x0,cx);y0=Math.min(y0,cy);x1=Math.max(x1,cx);y1=Math.max(y1,cy);}
      neighbours(current,next=>{if(!background[next]&&!outside[next]&&!visited[next]){visited[next]=1;queue[tail++]=next;}});
    }
    if(ink>=3 && ink<componentArea*.25 && x1>=x0 && y1>=y0)holes.push({x:x0,y:y0,width:x1-x0+1,height:y1-y0+1,pixels:ink});
  }
  if(!holes.length)return null;
  return {bounds:unionBounds(holes),backgroundBounds:componentBounds,components:holes.length,
    inkPixels:holes.reduce((sum,h)=>sum+h.pixels,0),backgroundPixels:componentArea,color};
}
function dominantColor(pixels,width,height,part,roi) {
  const buckets=new Map(),samples=[];
  for(let py=0;py<8;py++)for(let px=0;px<8;px++){
    const x=Math.max(0,Math.min(width-1,Math.floor(part.x-roi.x+(px+.5)*part.width/8)));
    const y=Math.max(0,Math.min(height-1,Math.floor(part.y-roi.y+(py+.5)*part.height/8)));
    const offset=(y*width+x)*4,r=pixels[offset],g=pixels[offset+1],b=pixels[offset+2];
    const key=(r>>5)+':'+(g>>5)+':'+(b>>5);buckets.set(key,(buckets.get(key)??0)+1);samples.push({key,r,g,b,index:y*width+x});
  }
  const [key,count]=[...buckets.entries()].sort((a,b)=>b[1]-a[1])[0];
  if(count<samples.length*.35)return null;
  const group=samples.filter(s=>s.key===key),median=channel=>group.map(s=>s[channel]).sort((a,b)=>a-b)[Math.floor(group.length/2)];
  return {color:[median('r'),median('g'),median('b')],seeds:group.map(s=>s.index)};
}
export function refineSpeechRegions(regions,image) {
  const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;
  const canvas=new OffscreenCanvas(1,1),ctx=canvas.getContext('2d',{willReadFrequently:true}),result=[];
  for(const region of regions){
    if(region.kind==='free'||!region.bubbleBounds){result.push(region);continue;}
    const bb=region.bubbleBounds,margin=Math.max(20,Math.min(80,Math.max(bb.width,bb.height)*.2));
    const expanded=clampBounds({x:Math.floor(bb.x-margin),y:Math.floor(bb.y-margin),width:Math.ceil(bb.width+margin*2),height:Math.ceil(bb.height+margin*2)},width,height);
    if(expanded.width*expanded.height>1_500_000){result.push(region);continue;}
    canvas.width=Math.max(1,Math.ceil(expanded.width));canvas.height=Math.max(1,Math.ceil(expanded.height));
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,expanded.x,expanded.y,expanded.width,expanded.height,0,0,canvas.width,canvas.height);
    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,components=new Map();
    for(const part of region.textParts??[region.textBounds??region.bounds]){
      const sample=dominantColor(rgba,canvas.width,canvas.height,part,expanded);if(!sample)continue;
      const found=enclosedInk(rgba,canvas.width,canvas.height,sample.seeds,sample.color);if(!found)continue;
      const bg=found.backgroundBounds,foreground=found.bounds;
      const originalPartArea=part.width*part.height;
      const overlap=Math.max(0,Math.min(expanded.x+foreground.x+foreground.width,part.x+part.width)-Math.max(expanded.x+foreground.x,part.x))*
        Math.max(0,Math.min(expanded.y+foreground.y+foreground.height,part.y+part.height)-Math.max(expanded.y+foreground.y,part.y));
      if(overlap/originalPartArea<.2 || found.inkPixels/found.backgroundPixels>.55)continue;
      const key=[Math.round(expanded.x+bg.x),Math.round(expanded.y+bg.y),bg.width,bg.height,...sample.color.map(c=>c>>3)].join(':');
      components.set(key,{...found,key,offset:expanded});
    }
    if(!components.size){result.push(region);continue;}
    let index=0;
    for(const found of components.values()){
      const b=found.bounds,padding=12;
      const bounds=clampBounds({x:found.offset.x+b.x-padding,y:found.offset.y+b.y-padding,width:b.width+2*padding,height:b.height+2*padding},width,height);
      // Keep tiny marks as review candidates instead of turning eyes or
      // punctuation into an automatically trusted text region.
      const fallback=region.fallback && found.components<3;
      result.push({...region,id:region.id+':ink-'+(++index),bounds,fallback,
        uncertain:fallback||region.uncertain&&!region.fallback,selected:!fallback&&(region.selected||region.fallback&&region.score>=.82),
        refinement:{version:REFINEMENT_VERSION,key:found.key,components:found.components,originalBounds:region.bounds}});
    }
  }
  const grouped=new Map(),final=[];
  for(const r of result){
    const key=r.refinement?.key;
    if(key && grouped.has(key)){
      const prior=grouped.get(key);prior.score=Math.max(prior.score,r.score);
      prior.selected||=r.selected;prior.uncertain&&=r.uncertain;
    }else{final.push(r);if(key)grouped.set(key,r);}
  }
  return final.sort((a,b)=>a.bounds.y-b.bounds.y||b.bounds.x-a.bounds.x).map((r,i)=>({...r,number:i+1}));
}

