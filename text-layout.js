(() => {
 if(globalThis.__mangaTextLayout)return;
 const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('tr',{granularity:'grapheme'}):null;
 function fitText(text,width,height,measure,maxSize=22) {
  const normalized=String(text).trim().split(/\r?\n/).map(p=>p.trim().replace(/\s+/g,' ')).join('\n');
  if(!normalized||width<=0||height<=0)return null;
  const paragraphs=normalized.split('\n'),graphemes=word=>segmenter?[...segmenter.segment(word)].map(s=>s.segment):Array.from(word);
  const unit=new Map(),metric=t=>{if(!unit.has(t))unit.set(t,measure(t,100)/100);return unit.get(t);};
  const wrap=(size,limit)=>{
   const lines=[];let current='';
   const append=(word,space=true)=>{
    const joined=current?current+(space?' ':'')+word:word;
    if(current&&metric(joined)*size>limit){lines.push(current);current=word;}else current=joined;
   };
   for(const paragraph of paragraphs){
    current='';
    for(const [index,word]of paragraph.split(' ').filter(Boolean).entries()){
     if(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word)){
      graphemes(word).forEach((char,i)=>append(char,i===0&&index>0));continue;
     }
     if(metric(word)*size<=limit||Array.from(word).length<=28){append(word);continue;}
     let part='';
     for(const char of graphemes(word)){if(part&&metric(part+char)*size>limit){append(part);part='';}part+=char;}
     if(part)append(part);
    }
    lines.push(current);
   }
   return lines;
  };
  const fits=size=>{const lines=wrap(size,width);return lines.length*size*1.08<=height&&lines.every(t=>metric(t)*size<=width+.001);};
  let lo=0,hi=Math.max(.001,maxSize);
  if(fits(hi))lo=hi;
  else for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(fits(mid))lo=mid;else hi=mid;}
  if(lo<=0)return null;
  const size=lo*.985,original=wrap(size,width);let left=0,right=width;
  // Balance the lines without increasing their count or changing the text.
  for(let i=0;i<7;i++){const mid=(left+right)/2;const lines=wrap(size,mid);
   if(lines.length<=original.length&&lines.every(t=>metric(t)*size<=mid+.001))right=mid;else left=mid;}
  const lines=wrap(size,right),lineHeight=size*1.08;
  return {fontSize:size,lineHeight,lines:lines.map(t=>({text:t,width:metric(t)*size})),height:lineHeight*lines.length,text:normalized};
 }
 const fontFamilies={'sans-serif':'"Manga Noto",Arial,sans-serif',serif:'Georgia,"Manga Noto",serif',comic:'"Comic Neue","Comic Sans MS","Manga Noto",sans-serif'};
 let fontReady;
 function prepareFonts(url=globalThis.chrome?.runtime?.getURL?.('assets/fonts/NotoSans.ttf')){
  if(!url||typeof FontFace==='undefined'||!globalThis.document?.fonts)return Promise.resolve(false);
  return fontReady??=new FontFace('Manga Noto','url('+JSON.stringify(String(url))+')',{weight:'100 900'}).load().then(font=>{document.fonts.add(font);return true;}).catch(()=>false);
 }
 function normalizeTextStyle(style={}){
  return {fontFamily:Object.hasOwn(fontFamilies,style.fontFamily)?style.fontFamily:'sans-serif',
   color:/^#[\da-f]{6}$/i.test(style.color??'')?style.color.toLowerCase():null,
   align:['auto','left','center','right'].includes(style.align)?style.align:'center',
   scale:Number.isFinite(style.scale)?Math.max(.5,Math.min(2,style.scale)):1};
 }
 function resolvedTextStyle(style={},appearance={}){const value=normalizeTextStyle(style);if(value.align==='auto')value.align=['left','right','center'].includes(appearance.alignment)?appearance.alignment:'center';return value;}
 const fontCss=(style,size)=>'600 '+size+'px '+fontFamilies[normalizeTextStyle(style).fontFamily];
 function inplaceGeometry(region,width=Infinity,height=Infinity){
  const old=region.displayOverride==='free'?null:region.displayGeometry;
  const b=old?.mode==='inside'?old.bounds:region.bounds;
  if(!b||![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0)throw Error('Yazı alanı geçersiz.');
  const bounds={x:Math.max(0,b.x),y:Math.max(0,b.y),width:Math.min(b.width,width-Math.max(0,b.x)),height:Math.min(b.height,height-Math.max(0,b.y))};
  if(bounds.width<=0||bounds.height<=0)throw Error('Yazı alanı görselin dışında.');
  const polygon=region.ocr?.lines?.[0]?.polygon??region.erasePolygons?.[0];
  let angle=region.appearance?.angle??(polygon?.length===4?Math.atan2(polygon[1][1]-polygon[0][1],polygon[1][0]-polygon[0][0])*180/Math.PI:0);
  if(!Number.isFinite(angle)||Math.abs(angle)>60)angle=0;
  const g={...old,version:'inline-v1',mode:'inside',bounds,angle,background:old?.background??region.background??'#fff',textColor:old?.textColor??region.textColor??'#171717'};
  if(!safeMask(g.clipPath))delete g.clipPath;
  if(angle){const c=Math.abs(Math.cos(angle*Math.PI/180)),s=Math.abs(Math.sin(angle*Math.PI/180)),ratio=Math.max((bounds.width*c+bounds.height*s)/bounds.width,(bounds.width*s+bounds.height*c)/bounds.height);g.textBounds={x:bounds.x+bounds.width*(1-1/ratio)/2,y:bounds.y+bounds.height*(1-1/ratio)/2,width:bounds.width/ratio,height:bounds.height/ratio};delete g.bands;}
  return g;
 }
 function fitRegionText(text,bounds,measure,style={},displayScale=1,bands,sourceFontSize){
  const normalized=normalizeTextStyle(style),max=Math.min(22*normalized.scale/Math.max(.001,displayScale),Number.isFinite(sourceFontSize)&&sourceFontSize>0?sourceFontSize*normalized.scale:Infinity);
  const rectangle=fitText(text,Math.max(.01,bounds.width-4),Math.max(.01,bounds.height-4),measure,max);
  if(!rectangle)return null;
  const decorate=fit=>{const pos=textPosition(bounds,fit,normalized.align);fit.lines=fit.lines.map((l,i)=>({...l,x:pos.x,y:pos.top+fit.fontSize*.83+i*fit.lineHeight}));return fit;};
  if(!Array.isArray(bands)||!bands.length)return decorate(rectangle);
  const content=String(text).trim().split(/\r?\n/).map(p=>p.trim().replace(/\s+/g,' '));
  const glyphs=word=>segmenter?[...segmenter.segment(word)].map(s=>s.segment):Array.from(word);
  function attempt(size){
   const lineHeight=size*1.08,capacity=Math.floor((bounds.height-4)/lineHeight);if(capacity<1)return null;
   let expected=Math.min(capacity,Math.max(1,rectangle.lines.length)),lines;
   for(let pass=0;pass<10;pass++){
    const top=bounds.y+(bounds.height-expected*lineHeight)/2;
    const slot=index=>{let left=bounds.x+2,right=bounds.x+bounds.width-2;const y=top+index*lineHeight;
     for(const band of bands)if(band.y<y+lineHeight&&band.y+band.height>y){left=Math.max(left,band.x+2);right=Math.min(right,band.x+band.width-2);}
     return {left,right,y,width:Math.max(0,right-left)};
    };
    lines=[];let current='';
    const push=()=>{const box=slot(lines.length);lines.push({text:current,width:measure(current,size),x:normalized.align==='left'?box.left:normalized.align==='right'?box.right:(box.left+box.right)/2,y:box.y+size*.83});current='';};
    for(const paragraph of content){
     for(const word of paragraph.split(' ').filter(Boolean)){
      const joined=current?current+' '+word:word;
      if(current&&measure(joined,size)>slot(lines.length).width)push();
      if(measure(word,size)<=slot(lines.length).width)current=current?current+' '+word:word;
      else for(const char of glyphs(word)){if(current&&measure(current+char,size)>slot(lines.length).width)push();current+=char;}
      if(lines.length>=capacity)return null;
     }
     push();if(lines.length>capacity)return null;
    }
    if(lines.length===expected){
     if(lines.some((line,i)=>line.width>slot(i).width+.01))return null;
     return {fontSize:size,lineHeight,lines,height:lineHeight*lines.length,text:rectangle.text};
    }
    expected=lines.length;
   }
   return null;
  }
  let lo=0,hi=rectangle.fontSize,best;
  for(let i=0;i<18;i++){const mid=(lo+hi)/2,fit=attempt(mid);if(fit){best=fit;lo=mid;}else hi=mid;}
  return best??decorate(rectangle);
 }
 function textPosition(bounds,fit,align='center'){
  return {x:align==='left'?bounds.x+2:align==='right'?bounds.x+bounds.width-2:bounds.x+bounds.width/2,
   top:bounds.y+(bounds.height-fit.height)/2,anchor:align==='left'?'start':align==='right'?'end':'middle'};
 }
 function safeColor(color,fallback='#fff'){
  if(/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(color??''))return color;
  if(color==='black'||color==='white')return color;
  const rgb=String(color??'').match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
  return rgb&&rgb.slice(1).every(v=>+v<=255)?'rgb('+rgb.slice(1).map(Number).join(',')+')':fallback;
 }
 function safeMask(path){
  return typeof path==='string'&&path.length>0&&path.length<=1000000&&/^[MmLlHhVvZz0-9eE+.,\-\s]+$/.test(path)&&
   (path.match(/[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi)??[]).every(n=>Number.isFinite(+n)&&Math.abs(+n)<=10000000);
 }
 function paintCommands(region,geometry,textCleanup=false){
  const background=safeColor(geometry.background??region.background),commands=[];
  const patch=region.cleanupPatch;if(patch&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(patch.dataUrl??'')&&patch.dataUrl.length<24000000)return {mode:patch.mode,commands:[{type:'image',...patch.bounds,dataUrl:patch.dataUrl}]};
  if((/^balloon-interior-v\d+$/.test(geometry.version??'')||geometry.version==='inline-v1')&&safeMask(geometry.clipPath))
   return {mode:'balloon-mask',commands:[{type:'path',path:geometry.clipPath,fill:background}]};
  const erase=region.eraseGeometry;
  if(textCleanup&&erase?.version==='text-mask-v1'&&erase.mode==='flat'&&safeMask(erase.path))
   return {mode:'glyph-mask',commands:[{type:'path',path:erase.path,fill:safeColor(erase.background,background)}]};
  const source=region.ocrBounds??region.bounds;
  if(source&&region.imageWidth>0&&region.imageHeight>0)for(const box of region.eraseBoxes??[]){
   if(![box.x0,box.x1,box.y0,box.y1].every(Number.isFinite)||box.x1<=box.x0||box.y1<=box.y0)continue;
   const px=source.width/region.imageWidth,py=source.height/region.imageHeight;
   commands.push({type:'rect',x:source.x+box.x0*px-2*px,y:source.y+box.y0*py-2*py,
    width:(box.x1-box.x0+4)*px,height:(box.y1-box.y0+4)*py,fill:background});
  }
  return {mode:'ocr-boxes',commands};
 }
 function drawingCommands(edits=[],bounds,background='#fff'){
  if(!Array.isArray(edits)||edits.length>100)throw Error('En fazla 100 yerel çizim düzenlemesi kullanılabilir.');
  if(!edits.length)return [];
  if(!bounds||![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite)||bounds.width<=0||bounds.height<=0)
   throw Error('Çizim için geçerli bir alan seç.');
  const commands=[],clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  for(const edit of edits){
   if(edit?.type==='fill'){
    const fill=edit.color===undefined?safeColor(background):safeColor(edit.color,null);
    if(!fill)throw Error('Dolgu rengi geçersiz.');
    commands.push({type:'rect',...bounds,fill});continue;
   }
   if(edit?.type!=='erase'||!Array.isArray(edit.points)||!edit.points.length||edit.points.length>2000||
      !Number.isFinite(edit.width)||edit.width<1||edit.width>100)throw Error('Silgi çizgisi geçersiz.');
   const points=edit.points.map(p=>{
    if(!p||![p.x,p.y].every(Number.isFinite))throw Error('Silgi noktası geçersiz.');
    return {x:clamp(p.x,bounds.x,bounds.x+bounds.width),y:clamp(p.y,bounds.y,bounds.y+bounds.height)};
   });
   if(points.length===1)commands.push({type:'circle',cx:points[0].x,cy:points[0].y,r:edit.width/2,fill:safeColor(background)});
   else commands.push({type:'path',path:points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(''),stroke:safeColor(background),width:edit.width});
  }
  return commands;
 }
 const intersects=(a,b,gap=0)=>a.left<b.left+b.width+gap&&a.left+a.width+gap>b.left&&a.top<b.top+b.height+gap&&a.top+a.height+gap>b.top;
 function packLabels(items,obstacles,bounds,gap=8) {
  const placed=[],unplaced=[];
  for(const item of [...items].sort((a,b)=>a.anchor.top-b.anchor.top||a.anchor.left-b.anchor.left||String(a.id).localeCompare(String(b.id)))){
   const a=item.anchor,w=item.width,h=item.height;
   const candidates=[
    {left:a.left+a.width+gap,top:a.top},{left:a.left-w-gap,top:a.top},
    {left:a.left,top:a.top+a.height+gap},{left:a.left,top:a.top-h-gap},
    {left:bounds.left+bounds.width-w,top:a.top},{left:bounds.left,top:a.top},
   ];
   let found;
   for(const candidate of candidates){
    const r={...candidate,width:w,height:h};
    if(r.left<bounds.left||r.left+w>bounds.left+bounds.width+.1)continue;
    for(let step=0;step<=obstacles.length+placed.length;step++){
     const collision=[...obstacles,...placed].find(b=>intersects(r,b,gap));
     if(!collision)break;r.top=collision.top+collision.height+gap;
    }
    if(r.top<bounds.top||r.top+h>bounds.top+bounds.height+.1||Math.abs(r.top-a.top)>160)continue;
    if([...obstacles,...placed].some(b=>intersects(r,b,gap)))continue;
    found=r;break;
   }
   if(found)placed.push({...found,id:item.id,items:[item]});else unplaced.push(item);
  }
  return {placed,unplaced};
 }
 globalThis.__mangaTextLayout={fitText,packLabels,intersects,normalizeTextStyle,resolvedTextStyle,fontCss,prepareFonts,fitRegionText,inplaceGeometry,textPosition,safeColor,safeMask,paintCommands,drawingCommands};
})();
