// Browser adaptation of RapidOCR 3.10.0 DB processing and CTC decoding.
// Copyright (c) 2021 RapidOCR Authors. Apache-2.0; see vendor/paddle/NOTICE.txt.
// Custom polygon offset and word geometry differ from the reference.
import {components8} from './pixel-masks.js';
import {bankersRound} from './paddle-pixels.js';
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export function convexHull(points){
 const p=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),lower=[],upper=[];
 for(const v of p){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),v)<=0)lower.pop();lower.push(v);}
 for(const v of p.reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),v)<=0)upper.pop();upper.push(v);}
 lower.pop();upper.pop();return lower.concat(upper);
}
export function orderQuad(points){
 const p=[...points].sort((a,b)=>a[0]-b[0]),left=p.slice(0,2).sort((a,b)=>a[1]-b[1]),right=p.slice(2).sort((a,b)=>a[1]-b[1]);
 return [left[0],right[0],right[1],left[1]];
}
export function minimumRectangle(points){
 const hull=convexHull(points);if(hull.length<3)return null;let best;
 for(let i=0;i<hull.length;i++){const a=hull[i],b=hull[(i+1)%hull.length],angle=Math.atan2(b[1]-a[1],b[0]-a[0]),c=Math.cos(angle),s=Math.sin(angle);
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(const [x,y]of hull){const xx=x*c+y*s,yy=-x*s+y*c;x0=Math.min(x0,xx);x1=Math.max(x1,xx);y0=Math.min(y0,yy);y1=Math.max(y1,yy);}
  const area=(x1-x0)*(y1-y0);if(!best||area<best.area-1e-6){const quad=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>[Math.fround(x*c-y*s),Math.fround(x*s+y*c)]);best={quad:orderQuad(quad),short:Math.min(x1-x0,y1-y0),area};}
 }return best;
}
function inside(x,y,quad){let sign=0;for(let i=0;i<4;i++){const d=cross(quad[i],quad[(i+1)%4],[x,y]);if(Math.abs(d)<1e-6)continue;if(sign&&Math.sign(d)!==sign)return false;sign=Math.sign(d);}return true;}
function scoreBox(prob,w,h,quad){
 const q=quad.map(([x,y])=>[Math.trunc(x),Math.trunc(y)]),xs=q.map(p=>p[0]),ys=q.map(p=>p[1]);let count=0,sum=0;
 for(let y=Math.max(0,Math.min(...ys));y<=Math.min(h-1,Math.max(...ys));y++)for(let x=Math.max(0,Math.min(...xs));x<=Math.min(w-1,Math.max(...xs));x++)if(inside(x,y,q)){sum+=prob[y*w+x];count++;}
 return sum/Math.max(1,count);
}
function expandQuad(quad,ratio){
 let area=0,perimeter=0;for(let i=0;i<4;i++){const a=quad[i],b=quad[(i+1)%4];area+=a[0]*b[1]-b[0]*a[1];perimeter+=Math.hypot(a[0]-b[0],a[1]-b[1]);}
 const distance=Math.abs(area/2)*ratio/perimeter,p=quad.map(v=>v.map(Math.trunc)),points=[];
 // Rounded integer polygon offset, matching the reference's Clipper input convention.
 const orientation=area>=0?1:-1;
 for(let i=0;i<4;i++){const prev=p[(i+3)%4],a=p[i],next=p[(i+1)%4];let start=Math.atan2(a[1]-prev[1],a[0]-prev[0])-orientation*Math.PI/2,end=Math.atan2(next[1]-a[1],next[0]-a[0])-orientation*Math.PI/2;
  if(orientation>0)while(end<start)end+=Math.PI*2;else while(end>start)end-=Math.PI*2;
  const steps=Math.max(1,Math.ceil(Math.abs(end-start)/Math.max(.05,Math.acos(Math.max(-1,1-.25/Math.max(.25,distance))))));
  for(let j=0;j<=steps;j++){const angle=start+(end-start)*j/steps;points.push([Math.round(a[0]+Math.cos(angle)*distance),Math.round(a[1]+Math.sin(angle)*distance)]);}
 }return minimumRectangle(points);
}
export function sortTextBoxes(boxes){
 const sorted=[...boxes].sort((a,b)=>a.quad[0][1]-b.quad[0][1]);let line=0,last=-Infinity;
 for(const b of sorted){if(b.quad[0][1]-last>=10)line++;last=b.quad[0][1];b.line=line;}
 return sorted.sort((a,b)=>a.line-b.line||a.quad[0][0]-b.quad[0][0]);
}
export function orderPaddleLines(lines,{sourceLanguage='en',writingMode='auto'}={}){
 if(lines.length<2)return [...lines];
 const bounds=l=>({top:Math.min(...l.polygon.map(p=>p[1])),bottom:Math.max(...l.polygon.map(p=>p[1])),left:Math.min(...l.polygon.map(p=>p[0])),right:Math.max(...l.polygon.map(p=>p[0]))});
 const cjk=sourceLanguage==='ja'||sourceLanguage==='zh';
 const vertical=writingMode==='vertical-rl'||writingMode==='auto'&&cjk&&lines.filter(l=>{const b=bounds(l);return b.bottom-b.top>1.5*(b.right-b.left);}).length>=lines.length/2;
 if(vertical){
  const columns=[];
  for(const line of [...lines].sort((a,b)=>bounds(b).right-bounds(a).right)){
   const b=bounds(line),column=columns.find(c=>Math.max(0,Math.min(c.right,b.right)-Math.max(c.left,b.left))>=.5*Math.min(c.right-c.left,b.right-b.left));
   if(column){column.items.push(line);column.left=Math.max(column.left,b.left);column.right=Math.min(column.right,b.right);}
   else columns.push({left:b.left,right:b.right,items:[line]});
  }
  return columns.sort((a,b)=>b.right-a.right).flatMap(c=>c.items.sort((a,b)=>bounds(a).top-bounds(b).top));
 }
 // A gutter spanning every line separates paragraphs; a gap inside one sentence does not.
 const byLeft=[...lines].sort((a,b)=>bounds(a).left-bounds(b).left);
 const heights=lines.map(l=>{const b=bounds(l);return b.bottom-b.top;}).sort((a,b)=>a-b),minGutter=heights[Math.floor(heights.length/2)];
 let right=-Infinity,split=-1,gutter=0;
 for(let i=0;i<byLeft.length-1;i++){
  right=Math.max(right,bounds(byLeft[i]).right);const gap=bounds(byLeft[i+1]).left-right;
  if(i>=1&&byLeft.length-i-1>=2&&gap>=minGutter&&gap>gutter){split=i+1;gutter=gap;}
 }
 if(split!==-1){
  const columns=[byLeft.slice(0,split),byLeft.slice(split)];if(cjk)columns.reverse();
  return columns.flatMap(column=>orderPaddleLines(column,{sourceLanguage,writingMode:'horizontal-tb'}));
 }
 const rows=[];for(const l of [...lines].sort((a,b)=>{const x=bounds(a),y=bounds(b);return (x.top+x.bottom-y.top-y.bottom)||x.left-y.left;})){
  const b=bounds(l),center=(b.top+b.bottom)/2;
  const matches=rows.filter(r=>Math.max(0,Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top))>=.5*Math.min(r.bottom-r.top,b.bottom-b.top)).sort((a,c)=>Math.abs(center-a.center)-Math.abs(center-c.center));
  const r=matches[0];if(r){r.items.push(l);r.top=Math.max(r.top,b.top);r.bottom=Math.min(r.bottom,b.bottom);r.center=(r.top+r.bottom)/2;}else rows.push({items:[l],top:b.top,bottom:b.bottom,center});
 }return rows.sort((a,b)=>a.top-b.top).flatMap(r=>r.items.sort((a,b)=>bounds(a).left-bounds(b).left));
}
export function joinPaddleLines(lines,{sourceLanguage='en',writingMode='horizontal-tb'}={}){
 if(sourceLanguage!=='ja'&&sourceLanguage!=='zh')return lines.map(line=>line.text).join('\n');
 const vertical=writingMode==='vertical-rl',range=line=>{
  const values=line.polygon.map(point=>point[vertical?0:1]);return [Math.min(...values),Math.max(...values)];
 };
 return lines.map((line,index)=>{
  if(!index)return line.text;
  const a=range(lines[index-1]),b=range(line),sameGroup=Math.max(0,Math.min(a[1],b[1])-Math.max(a[0],b[0]))>=.5*Math.min(a[1]-a[0],b[1]-b[0]);
  return (sameGroup?'':'\n')+line.text;
 }).join('');
}
export function decodeDetection(prob,width,height,destWidth,destHeight,config={}){
 const {thresh=.3,boxThreshold=.5,unclipRatio=1.6,maxCandidates=1000}=config;
 const base=Uint8Array.from(prob,v=>v>thresh?1:0),mask=new Uint8Array(base.length);
 // The pinned reference uses a 2x2 dilation kernel with anchor (1,1).
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)mask[y*width+x]=base[y*width+x]||(x&&base[y*width+x-1])||(y&&base[(y-1)*width+x])||(x&&y&&base[(y-1)*width+x-1])?1:0;
 const {labels,parts}=components8(mask,width,height),boundaries=new Map(parts.map(p=>[p.id,[]]));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const id=labels[y*width+x];if(id&&(!x||!y||x===width-1||y===height-1||labels[y*width+x-1]!==id||labels[y*width+x+1]!==id||labels[(y-1)*width+x]!==id||labels[(y+1)*width+x]!==id))boundaries.get(id).push([x,y]);}
 const contours=[...boundaries.values()];
 // RETR_LIST also contains enclosed background contours; include their adjacent foreground edges.
 const holes=components8(Uint8Array.from(mask,v=>1-v),width,height);
 for(const hole of holes.parts)if(!hole.touchesEdge){const pts=[];for(let y=hole.y;y<hole.y+hole.height;y++)for(let x=hole.x;x<hole.x+hole.width;x++)if(holes.labels[y*width+x]===hole.id){for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]])if(mask[(y+dy)*width+x+dx])pts.push([x+dx,y+dy]);}if(pts.length)contours.push(pts);}
 const boxes=[];
 for(const contour of contours.reverse().slice(0,maxCandidates)){
  const first=minimumRectangle(contour);if(!first||first.short<3)continue;
  const score=scoreBox(prob,width,height,first.quad);if(score<boxThreshold)continue;
  const expanded=expandQuad(first.quad,unclipRatio);if(!expanded||expanded.short<5)continue;
  const quad=orderQuad(expanded.quad.map(([x,y])=>[Math.max(0,Math.min(destWidth-1,bankersRound(x/width*destWidth))),Math.max(0,Math.min(destHeight-1,bankersRound(y/height*destHeight)))]));
  if(Math.floor(Math.hypot(quad[0][0]-quad[1][0],quad[0][1]-quad[1][1]))<=3||Math.floor(Math.hypot(quad[0][0]-quad[3][0],quad[0][1]-quad[3][1]))<=3)continue;
  boxes.push({quad,score});
 }return sortTextBoxes(boxes);
}
export function decodeCtc(data,steps,channels,characters){
 if(characters.length!==channels)throw Error('Paddle character dictionary/model mismatch');
 const glyphs=[];let previous=-1;
 for(let t=0;t<steps;t++){let best=0;for(let c=1;c<channels;c++)if(data[t*channels+c]>data[t*channels+best])best=c;
  if(best!==0&&best!==previous)glyphs.push({text:characters[best],step:t,score:Math.round(data[t*channels+best]*1e5)/1e5});previous=best;
 }
 return {text:glyphs.map(g=>g.text).join(''),confidence:glyphs.length?Math.round(glyphs.reduce((s,g)=>s+g.score,0)/glyphs.length*1e5)/1e3:0,glyphs,steps};
}
export function lineResult(decoded,quad,contentSteps,rotated=false){
 const bound=q=>({x0:Math.min(...q.map(p=>p[0])),y0:Math.min(...q.map(p=>p[1])),x1:Math.max(...q.map(p=>p[0])),y1:Math.max(...q.map(p=>p[1]))});
 const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],words=[];let current=[];
 const flush=()=>{if(!current.length)return;const a=Math.max(0,Math.min(1,(current[0].step-1)/contentSteps)),b=Math.max(a,Math.min(1,(current.at(-1).step+2)/contentSteps));
  const p=rotated?[mix(quad[0],quad[3],a),mix(quad[1],quad[2],a),mix(quad[1],quad[2],b),mix(quad[0],quad[3],b)]:[mix(quad[0],quad[1],a),mix(quad[0],quad[1],b),mix(quad[3],quad[2],b),mix(quad[3],quad[2],a)];
  words.push({text:current.map(g=>g.text).join(''),confidence:current.reduce((s,g)=>s+g.score,0)/current.length*100,bbox:bound(p),polygon:p});current=[];};
 for(const g of decoded.glyphs){if(/^\s+$/.test(g.text))flush();else current.push(g);}flush();
 return {text:decoded.text.trim(),confidence:decoded.confidence,bbox:bound(quad),polygon:quad,words};
}
