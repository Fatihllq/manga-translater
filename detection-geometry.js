// Native image coordinates throughout; CSS/display coordinates stay in content.js.
export const DETECTOR_SIZE = 640;
export const DEFAULT_OPTIONS = Object.freeze({
  candidateScore: 0.28, selectedScore: 0.62, freeSelectedScore: 0.68,
  tileSize: 1280, overlap: 0.25, duplicateIoU: 0.45,
});
export function area(b) { return Math.max(0, b.width) * Math.max(0, b.height); }
export function intersection(a, b) {
  return Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) *
    Math.max(0, Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
}
export function iou(a,b) { const n=intersection(a,b); return n/(area(a)+area(b)-n || 1); }
export function unionBounds(boxes) {
  const x=Math.min(...boxes.map(b=>b.x)), y=Math.min(...boxes.map(b=>b.y));
  return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};
}
export function clampBounds(b,width,height) {
  const x=Math.max(0,Math.min(width,b.x)), y=Math.max(0,Math.min(height,b.y));
  const right=Math.max(x,Math.min(width,b.x+b.width)), bottom=Math.max(y,Math.min(height,b.y+b.height));
  return {x,y,width:right-x,height:bottom-y};
}
export function makeTiles(width,height,options=DEFAULT_OPTIONS) {
  if (!Number.isFinite(width*height) || width<8 || height<8) throw new Error('Geçersiz görsel boyutu.');
  const result=[{x:0,y:0,width,height,full:true}];
  if(Math.max(width,height)<=options.tileSize) return result;
  function starts(length) {
    if(length<=options.tileSize) return [0];
    const step=Math.round(options.tileSize*(1-options.overlap)), values=[];
    for(let n=0;n<length-options.tileSize;n+=step) values.push(n);
    values.push(length-options.tileSize);
    return [...new Set(values)];
  }
  for(const y of starts(height)) for(const x of starts(width)) {
    result.push({x,y,width:Math.min(options.tileSize,width),height:Math.min(options.tileSize,height),full:false});
  }
  return result;
}
export function decodeDetections(results,tile,options=DEFAULT_OPTIONS) {
  const values=[];
  const {labels,boxes,scores}=results;
  if(!labels || !boxes || !scores) throw new Error('Algılama modeli beklenen sonuçları vermedi.');
  for(let i=0;i<scores.data.length;i++) {
    const score=Number(scores.data[i]),label=Number(labels.data[i]);
    if(!Number.isFinite(score) || score<options.candidateScore || ![0,1,2].includes(label)) continue;
    const p=Array.from(boxes.data.slice(i*4,i*4+4),Number);
    if(p.length!==4 || !p.every(Number.isFinite)) continue;
    const local=clampBounds({x:p[0],y:p[1],width:p[2]-p[0],height:p[3]-p[1]},tile.width,tile.height);
    if(local.width<4 || local.height<4) continue;
    const clipped=!tile.full && ((tile.x>0 && local.x<3) || (tile.y>0 && local.y<3) ||
      (local.x+local.width>tile.width-3) || (local.y+local.height>tile.height-3));
    values.push({...local,x:local.x+tile.x,y:local.y+tile.y,label,score,clipped,full:tile.full});
  }
  return values;
}
export function deduplicate(boxes,options=DEFAULT_OPTIONS) {
  // Prefer a complete prediction over a high-scoring fragment at a tile boundary.
  const ranked=[...boxes].sort((a,b)=>(Number(a.clipped)-Number(b.clipped)) || b.score-a.score);
  const kept=[];
  for(const b of ranked) {
    const prior=kept.find(a=>
      ((a.label===b.label && (iou(a,b)>=options.duplicateIoU || intersection(a,b)/Math.min(area(a),area(b))>=0.88)) ||
       (a.label>0 && b.label>0 && iou(a,b)>=0.8)));
    if(!prior) kept.push({...b});
    else if(!prior.clipped && !b.clipped && iou(prior,b)>=0.7) prior.score=Math.max(prior.score,b.score);
  }
  return kept;
}
export function assembleRegions(raw,width,height,options=DEFAULT_OPTIONS) {
  const boxes=deduplicate(raw,options);
  const bubbles=boxes.filter(b=>b.label===0);
  const text=boxes.filter(b=>b.label!==0);
  const groups=new Map(), free=[];
  for(const b of text) {
    const candidates=b.label===1 ? bubbles.filter(a=>intersection(a,b)/area(b)>=0.85) : [];
    const bubble=candidates.sort((a,c)=>area(a)-area(c))[0];
    if(bubble) {
      const grouped=groups.get(bubble) ?? [];
      grouped.push(b); groups.set(bubble,grouped);
    } else free.push(b);
  }
  const regions=[];
  const add=(parts,bubble=null,fallback=false)=>{
    const original=unionBounds(parts), score=Math.min(...parts.map(b=>b.score));
    const padding=Math.max(8,Math.min(16,Math.max(original.width,original.height)*0.05));
    const bounds=clampBounds({x:original.x-padding,y:original.y-padding,width:original.width+2*padding,height:original.height+2*padding},width,height);
    const kind=parts[0].label===2?'free':bubble?'bubble':'text';
    const uncertain=fallback || parts.some(b=>b.clipped) || score<(kind==='free'?options.freeSelectedScore:options.selectedScore);
    regions.push({bounds,kind,score,uncertain,selected:!uncertain,fallback,
      bubbleBounds:bubble?{x:bubble.x,y:bubble.y,width:bubble.width,height:bubble.height}:null,
      textBounds:original,textParts:parts.map(b=>({x:b.x,y:b.y,width:b.width,height:b.height})),labels:[...new Set(parts.map(b=>b.label))]});
  };
  for(const [bubble,parts] of groups) {
    // Containment alone can join two speech balloons if a false large bubble
    // encloses both. Separate distant blocks instead of merging neighbours.
    const joined=unionBounds(parts);
    if(parts.length>1 && parts.reduce((n,b)=>n+area(b),0)/area(joined)<0.22) {
      for(const part of parts) add([part],bubble);
    } else add(parts,bubble);
  }
  for(const part of free) add([part]);
  for(const bubble of bubbles) {
    if(groups.has(bubble) || text.some(t=>intersection(bubble,t)/area(t)>0.5)) continue;
    // Empty balloon detections are review-only; never select them automatically.
    const inset=Math.max(4,Math.min(bubble.width,bubble.height)*0.12);
    const inner={...bubble,x:bubble.x+inset,y:bubble.y+inset,width:bubble.width-2*inset,height:bubble.height-2*inset,label:1};
    if(inner.width>=8 && inner.height>=8) add([inner],bubble,true);
  }
  return regions.sort((a,b)=>a.bounds.y-b.bounds.y || b.bounds.x-a.bounds.x)
    .map((r,index)=>({...r,id:'region-'+(index+1),number:index+1}));
}
