// Analysis never changes OCR pixels or their coordinate system.
export const LAYOUT_VERSION = 'ink-projection-v2-rows';
export const LAYOUT_PROFILES = Object.freeze({
 strict: Object.freeze({flat: .82, slope: .10, spread: .25, wordGap: .35}),
 balanced: Object.freeze({flat: .74, slope: .15, spread: .35, wordGap: .45}),
 wide: Object.freeze({flat: .66, slope: .20, spread: .45, wordGap: .55}),
});
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]??0;};
export function classifyLayout(layout, profile='strict') {
 const f=layout?.features,p=LAYOUT_PROFILES[profile];
 if(!f||!p||f.invalid||f.rows!==1||f.components<2||f.flat<p.flat||f.aspect<1.5||
    f.inkFraction<.005||f.inkFraction>.45||Math.abs(f.slope)>p.slope||f.centerSpread>p.spread||f.outsideInk>.06||f.charHeight<6)return 'block';
 return f.maxGapRatio<p.wordGap?'word':'line';
}
export function analyzeOcrPixels({data,width,height}) {
 const base={version:LAYOUT_VERSION,width,height,kind:'block'};
 if(!data||width<8||height<8||width*height>512*512||data.length!==width*height*4)return {...base,reason:'invalid-analysis-size'};
 const n=width*height,hist=new Uint32Array(4096);
 for(let i=0;i<n;i++){const q=i*4;if(data[q+3]<128)continue;hist[((data[q]>>4)<<8)|((data[q+1]>>4)<<4)|(data[q+2]>>4)]++;}
 let dominant=0;for(let i=1;i<hist.length;i++)if(hist[i]>hist[dominant])dominant=i;
 const sums=[0,0,0];let matches=0;
 for(let i=0;i<n;i++){const q=i*4;if((((data[q]>>4)<<8)|((data[q+1]>>4)<<4)|(data[q+2]>>4))!==dominant)continue;
  for(let c=0;c<3;c++)sums[c]+=data[q+c];matches++;}
 if(!matches)return {...base,reason:'no-background'};
 const bg=sums.map(s=>s/matches),mask=new Uint8Array(n);let flat=0,ink=0,chromatic=0;
 for(let i=0;i<n;i++){const q=i*4,d=Math.abs(data[q]-bg[0])+Math.abs(data[q+1]-bg[1])+Math.abs(data[q+2]-bg[2]);
  if(Math.max(data[q],data[q+1],data[q+2])-Math.min(data[q],data[q+1],data[q+2])>=24)chromatic++;
  if(d<65)flat++;if(d>=90&&data[q+3]>=128){mask[i]=1;ink++;}}
 if(flat/n<.66||ink<4)return {...base,reason:'complex-or-empty-background',features:{invalid:true,flat:flat/n,chromaticFraction:chromatic/n}};
 const queue=new Int32Array(n),components=[];let removed=0;
 for(let i=0;i<n;i++)if(mask[i]===1){let head=0,tail=1;queue[0]=i;mask[i]=2;
  let x0=width,y0=height,x1=0,y1=0,sx=0,sy=0;
  while(head<tail){const at=queue[head++],x=at%width,y=Math.floor(at/width);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);sx+=x;sy+=y;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;const k=yy*width+xx;if(mask[k]===1){mask[k]=2;queue[tail++]=k;}}}
  const w=x1-x0+1,h=y1-y0+1;
  const frame=(w>width*.85&&h>height*.65)||(w>width*.85&&h<Math.max(3,height*.035))||(h>height*.85&&w<Math.max(3,width*.035));
  if(frame){removed+=tail;continue;}
  components.push({x0,y0,x1,y1,w,h,area:tail,cx:sx/tail,cy:sy/tail});
 }
 if(removed>ink*.35||components.length<2)return {...base,reason:'frame-or-insufficient-letters',features:{invalid:true,flat:flat/n,chromaticFraction:chromatic/n}};
 const charHeight=median(components.map(c=>c.h)),core=components.filter(c=>c.h>=charHeight*.45&&c.area>=3);
 if(core.length<2)return {...base,reason:'insufficient-letters',features:{invalid:true}};
 const rowMask=new Uint8Array(height),columnMask=new Uint8Array(width);
 for(const c of core){for(let y=c.y0;y<=c.y1;y++)rowMask[y]=1;for(let x=c.x0;x<=c.x1;x++)columnMask[x]=1;}
 const merge=Math.max(1,Math.floor(charHeight*.10));
 let last=-1;for(let y=0;y<height;y++)if(rowMask[y]){if(last>=0&&y-last-1<=merge)rowMask.fill(1,last,y);last=y;}
 let rows=0,active=false;for(const v of rowMask){if(v&&!active)rows++;active=!!v;}
 const x0=Math.min(...core.map(c=>c.x0)),x1=Math.max(...core.map(c=>c.x1)),y0=Math.min(...core.map(c=>c.y0)),y1=Math.max(...core.map(c=>c.y1));
 let maxGap=0,gap=0;for(let x=x0;x<=x1;x++){if(columnMask[x])gap=0;else{gap++;maxGap=Math.max(maxGap,gap);}}
 const mx=core.reduce((s,c)=>s+c.cx,0)/core.length,my=core.reduce((s,c)=>s+c.cy,0)/core.length;
 let numerator=0,denominator=0;for(const c of core){numerator+=(c.cx-mx)*(c.cy-my);denominator+=(c.cx-mx)**2;}
 const outside=components.filter(c=>c.y1<y0-charHeight*.3||c.y0>y1+charHeight*.3).reduce((s,c)=>s+c.area,0);
 const features={rows,components:core.length,flat:flat/n,chromaticFraction:chromatic/n,aspect:(x1-x0+1)/(y1-y0+1),inkFraction:(ink-removed)/n,
  slope:denominator?numerator/denominator:0,centerSpread:(Math.max(...core.map(c=>c.cy))-Math.min(...core.map(c=>c.cy)))/Math.max(1,charHeight),
  outsideInk:outside/Math.max(1,ink-removed),maxGapRatio:maxGap/Math.max(1,charHeight),charHeight};
 const rowBoxes=[];
 if(rows>=2&&rows<=8&&!core.some(c=>c.w>charHeight*5)){
  const bands=[];let begin=-1;
  for(let y=0;y<=height;y++){if(rowMask[y]&&begin<0)begin=y;if(!rowMask[y]&&begin>=0){bands.push({top:begin,bottom:y-1,letters:[],parts:[]});begin=-1;}}
  let unassigned=0;
  for(const c of components){
   const choices=bands.map(b=>({b,d:Math.max(0,b.top-c.y1,c.y0-b.bottom)})).filter(v=>v.d<=charHeight*.35).sort((a,b)=>a.d-b.d);
   if(!choices.length||(choices[1]&&choices[0].d===choices[1].d)){unassigned+=c.area;continue;}
   choices[0].b.parts.push(c);if(core.includes(c))choices[0].b.letters.push(c);
  }
  if(unassigned===0)for(const b of bands){
   if(b.letters.length<2){rowBoxes.length=0;break;}
   const mx=b.letters.reduce((s,c)=>s+c.cx,0)/b.letters.length,my=b.letters.reduce((s,c)=>s+c.cy,0)/b.letters.length;
   let num=0,den=0;for(const c of b.letters){num+=(c.cx-mx)*(c.cy-my);den+=(c.cx-mx)**2;}
   const pad=Math.max(1,Math.ceil(charHeight*.15));
   rowBoxes.push({x0:Math.max(0,Math.min(...b.parts.map(c=>c.x0))-pad),y0:Math.max(0,Math.min(...b.parts.map(c=>c.y0))-pad),
    x1:Math.min(width,Math.max(...b.parts.map(c=>c.x1))+1+pad),y1:Math.min(height,Math.max(...b.parts.map(c=>c.y1))+1+pad),slope:den?num/den:0});
  }
  if(rowBoxes.length===bands.length)for(let i=1;i<rowBoxes.length;i++){
   const top=Math.min(...bands[i].parts.map(c=>c.y0)),bottom=Math.max(...bands[i-1].parts.map(c=>c.y1))+1;
   if(top<bottom){rowBoxes.length=0;break;}
   const boundary=Math.floor((top+bottom)/2);
   rowBoxes[i-1].y1=Math.min(rowBoxes[i-1].y1,boundary);rowBoxes[i].y0=Math.max(rowBoxes[i].y0,boundary);
  }
 }
 const result={...base,features,rowBoxes};result.kind=classifyLayout(result);return result;
}
export function analyzeOcrCanvas(canvas) {
 const started=performance.now();
 const scale=Math.min(1,512/Math.max(canvas.width,canvas.height));
 const copy=document.createElement('canvas');copy.width=Math.max(1,Math.round(canvas.width*scale));copy.height=Math.max(1,Math.round(canvas.height*scale));
 try{const ctx=copy.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0,copy.width,copy.height);
  const layout=analyzeOcrPixels(ctx.getImageData(0,0,copy.width,copy.height)),sx=canvas.width/copy.width,sy=canvas.height/copy.height;
  if(layout.rowBoxes){
   const boxes=layout.rowBoxes;layout.rowBoxes=boxes.map(b=>({...b,x0:Math.floor(b.x0*sx),y0:Math.floor(b.y0*sy),x1:Math.ceil(b.x1*sx),y1:Math.ceil(b.y1*sy)}));
   for(let i=1;i<boxes.length;i++)if(layout.rowBoxes[i].y0<layout.rowBoxes[i-1].y1){
    const boundary=Math.round((boxes[i-1].y1+boxes[i].y0)*sy/2);layout.rowBoxes[i-1].y1=boundary;layout.rowBoxes[i].y0=boundary;
   }
  }
  return {...layout,width:canvas.width,height:canvas.height,analysisMs:performance.now()-started};
 }finally{copy.width=copy.height=1;}
}
