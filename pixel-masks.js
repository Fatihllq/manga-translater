export function components8(mask,width,height){
 const labels=new Int32Array(mask.length),queue=new Int32Array(mask.length),parts=[];let serial=0;
 for(let i=0;i<mask.length;i++)if(mask[i]&&!labels[i]){
  const id=++serial;let head=0,tail=1,x0=width,y0=height,x1=0,y1=0;queue[0]=i;labels[i]=id;
  while(head<tail){const at=queue[head++],x=at%width,y=Math.floor(at/width);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
   for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++){
    const k=yy*width+xx;if(mask[k]&&!labels[k]){labels[k]=id;queue[tail++]=k;}
   }
  }
  parts.push({id,x:x0,y:y0,width:x1-x0+1,height:y1-y0+1,area:tail,touchesEdge:x0===0||y0===0||x1===width-1||y1===height-1});
 }
 return {labels,parts};
}
export function dilate(mask,width,height,radius=1){
 const out=new Uint8Array(mask.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask[y*width+x])
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
   if(dx*dx+dy*dy>radius*radius+radius*.5)continue;
   const xx=x+dx,yy=y+dy;if(xx>=0&&xx<width&&yy>=0&&yy<height)out[yy*width+xx]=1;
  }
 return out;
}
export function erode(mask,width,height,radius=1){
 const out=new Uint8Array(mask.length);
 for(let y=radius;y<height-radius;y++)for(let x=radius;x<width-radius;x++){
  let safe=true;for(let dy=-radius;dy<=radius&&safe;dy++)for(let dx=-radius;dx<=radius;dx++)if(!mask[(y+dy)*width+x+dx]){safe=false;break;}
  if(safe)out[y*width+x]=1;
 }
 return out;
}
export function maskPath(mask,width,height,roi={x:0,y:0,width,height}){
 const open=new Map(),rects=[],sx=roi.width/width,sy=roi.height/height;
 for(let y=0;y<=height;y++){
  const row=new Map();if(y<height)for(let x=0;x<width;){if(!mask[y*width+x]){x++;continue;}const left=x;while(x<width&&mask[y*width+x])x++;row.set(left+':'+x,{left,right:x});}
  for(const [key,r] of open)if(!row.has(key)){rects.push(r);open.delete(key);}
  for(const [key,r] of row){if(open.has(key))open.get(key).bottom=y+1;else open.set(key,{...r,top:y,bottom:y+1});}
 }
 const n=x=>Number(x.toFixed(3));
 return rects.map(r=>'M'+n(roi.x+r.left*sx)+' '+n(roi.y+r.top*sy)+'h'+n((r.right-r.left)*sx)+'v'+n((r.bottom-r.top)*sy)+'h-'+n((r.right-r.left)*sx)+'Z').join('');
}
