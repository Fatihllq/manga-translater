(() => {
 if(globalThis.__mangaOverlayManager)return;
 const assets=new Map(),roots=new Map(),records=new Map(),dirty=new Set(),editorViews=new Set(),layouts=new Map(),labelDirtyAssets=new Set();
 const glyphBounds=r=>{const b=r.node?.querySelector('text')?.getBBox();return b?{x:b.x,y:b.y,width:b.width,height:b.height}:undefined;};
 const svgNs='http://www.w3.org/2000/svg',textLayout=globalThis.__mangaTextLayout;
 const stats={geometryPasses:0,textFits:0,labelPasses:0,scrollEvents:0};
 const features=globalThis.__mangaFeatures??{missingTranslationFallback:true,textCleanup:false};
 function displayState(record,state){
  if(record.state===state)return;record.state=state;
  assets.get(record.assetId)?.onDisplay?.({regionId:record.id,layoutSession:record.sessionId,
   revision:record.region.revision||0,editRevision:record.region.editRevision||0,state,mode:record.mode,fallbackReason:record.fallbackReason});
 }
 let queued=false,labelsDirty=false,serial=0,canvas,activeSession,fontVersion=0,inlineEditor,canvasTimer;
 const cancelledSessions=new Set();
 const own=node=>node?.nodeType===1&&(node.hasAttribute('data-manga-overlay')||Boolean(node.closest?.('[data-manga-overlay]')));
 const svg=(name,attrs={})=>{const e=document.createElementNS(svgNs,name);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
 const notify=id=>{if(id)labelDirtyAssets.add(id);labelsDirty=true;schedule();};
 function scrollRoot(image){
  for(let p=image.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){
   const c=getComputedStyle(p);
   if(/auto|scroll|hidden|clip/.test(c.overflowY+c.overflowX)&&(p.scrollHeight>p.clientHeight+1||p.scrollWidth>p.clientWidth+1||/hidden|clip/.test(c.overflowY+c.overflowX)))return p;
  }
  return document.documentElement;
 }
 function container(image){
  const scroller=scrollRoot(image);
  for(let p=image.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){
   const c=getComputedStyle(p);
   if(c.position!=='static'||c.transform!=='none'||/layout|paint/.test(c.contain))return {parent:p,scroller};
   if(p===scroller)break;
  }
  return {parent:scroller,scroller};
 }
 function rootFor(image){
  const chosen=container(image);let state=roots.get(chosen.parent);if(state)return state;
  const parent=chosen.parent,c=getComputedStyle(parent);let changed=parent!==document.documentElement&&c.position==='static'&&c.transform==='none',flowAnchor=false;
  const oldPosition=parent.style.getPropertyValue('position'),oldPriority=parent.style.getPropertyPriority('position');
  const restorePosition=()=>{if(oldPosition)parent.style.setProperty('position',oldPosition,oldPriority);else parent.style.removeProperty('position');};
  const rectOf=e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height];};
  const externalAbsolute=changed?[...parent.querySelectorAll('*')].filter(e=>!own(e)&&getComputedStyle(e).position==='absolute'&&!parent.contains(e.offsetParent)):[];
  const watched=[image,...externalAbsolute],before=watched.map(rectOf),dimensions=[parent.scrollWidth,parent.scrollHeight];
  const stable=()=>watched.every((e,i)=>rectOf(e).every((n,j)=>Math.abs(n-before[i][j])<.01))&&parent.scrollWidth===dimensions[0]&&parent.scrollHeight===dimensions[1];
  if(changed){parent.style.setProperty('position','relative');if(!stable()){restorePosition();changed=false;flowAnchor=true;}}
  const host=document.createElement('div');host.setAttribute('data-manga-overlay','layout');
  host.style.cssText='all:initial;display:block;position:'+(flowAnchor?'relative':'absolute')+';left:0;top:0;width:100%;height:'+(flowAnchor?'0':'1px')+';z-index:2147483645;pointer-events:none;overflow:visible;';
  const shadow=host.attachShadow({mode:'closed'}),style=document.createElement('style');
  style.textContent='*{box-sizing:border-box}.image-clip{position:absolute;overflow:hidden;pointer-events:none}.image-svg{position:absolute;overflow:visible;pointer-events:none}.translation-hit{pointer-events:all;cursor:text}.translation-hit:focus-visible{stroke:#2563eb;stroke-width:2}.inline-editor{position:absolute;z-index:2;pointer-events:auto;width:300px;max-width:calc(100vw - 24px);padding:10px;border:2px solid #2563eb;border-radius:6px;background:#fff;color:#171717;box-shadow:0 3px 14px #0004;font:14px/1.4 Arial,sans-serif}.inline-editor textarea{display:block;width:100%;min-height:90px;resize:vertical;font:inherit;border:1px solid #64748b;padding:6px}.inline-editor button{font:inherit;margin:6px 6px 0 0;min-height:32px;border:1px solid #64748b;border-radius:4px;padding:3px 8px;background:#f8fafc;color:#171717}.inline-editor :focus-visible{outline:2px solid #2563eb;outline-offset:2px}.inline-editor p{margin:5px 0;font-size:12px}.inline-editor [role=status]{color:#a21d1d}';
  const origin=document.createElement('span');origin.style.cssText='position:absolute;left:0;top:-1024px;width:100%;height:1024px;pointer-events:none';
  shadow.append(style,origin);parent.append(host);
  if(flowAnchor&&!stable()){host.remove();throw Error('Bu okuyucuda güvenli yerel katman bağlanamadı; özgün görsel korundu.');}
  state={origin,flowAnchor,parent,scroller:chosen.scroller,host,shadow,assets:new Set(),boxes:[],changed,oldPosition,oldPriority};
  roots.set(parent,state);resizeObserver.observe(parent);return state;
 }
 function dropRoot(root){
  if(root.assets.size)return;
  root.host.remove();resizeObserver.unobserve(root.parent);roots.delete(root.parent);
  if(root.changed&&root.parent.style.getPropertyValue('position')==='relative'){
   if(root.oldPosition)root.parent.style.setProperty('position',root.oldPosition,root.oldPriority);else root.parent.style.removeProperty('position');
  }
 }
 function attach(asset,image){
  if(asset.image===image&&asset.root?.host.isConnected&&asset.root.parent===container(image).parent)return;
  if(asset.image)resizeObserver.unobserve(asset.image);
  if(asset.root){asset.viewport?.remove();const old=asset.root;old.assets.delete(asset.id);asset.root=undefined;dropRoot(old);}
  asset.image=image;asset.measured=undefined;asset.failure=undefined;
  for(const record of records.values())if(record.assetId===asset.id)displayState(record,'waiting-for-image');
  if(!image?.isConnected)return;
  let root;try{root=rootFor(image);}catch(error){asset.failure=error.message;return;}asset.root=root;root.assets.add(asset.id);resizeObserver.observe(image);
  const viewport=document.createElement('div');viewport.className='image-clip';
  const layer=svg('svg',{'class':'image-svg','preserveAspectRatio':'none',role:'group','aria-label':'Düzenlenebilir çeviriler'});
  viewport.append(layer);root.shadow.append(viewport);asset.viewport=viewport;asset.layer=layer;
  for(const record of records.values())if(record.assetId===asset.id){if(record.mode==='inside')renderInside(record,asset);else renderDrawing(record,asset);}
 }
 function measureAsset(asset){
  const info=asset.read();asset.info=info;if(!info?.image?.isConnected||!info.placement){attach(asset,null);return;}
  attach(asset,info.image);if(!asset.root)return;
  const rr=asset.root.origin.getBoundingClientRect(),sx=rr.width/(asset.root.host.clientWidth||rr.width||1),sy=rr.height/1024||1,p=info.placement,d=info.descriptor;
  const point=(left,top)=>({left:(left-rr.left)/sx,top:(top-rr.top-rr.height)/sy});
  const img={...point(p.left,p.top),width:p.width/sx,height:p.height/sy};
  const clip={...point(p.clip.left,p.clip.top),width:(p.clip.right-p.clip.left)/sx,height:(p.clip.bottom-p.clip.top)/sy};
  asset.info=info;asset.measured={img,clip,sx,sy};
  return {asset,img,clip,d};
 }
 function writeAsset(read){
  if(!read)return;
  const {asset,img,clip,d}=read,v=asset.viewport,l=asset.layer;
  v.hidden=false;Object.assign(v.style,{left:clip.left+'px',top:clip.top+'px',width:clip.width+'px',height:clip.height+'px'});
  l.setAttribute('viewBox','0 0 '+d.width+' '+d.height);
  Object.assign(l.style,{left:img.left-clip.left+'px',top:img.top-clip.top+'px',width:img.width+'px',height:img.height+'px'});
  for(const record of records.values())if(record.assetId===asset.id){if(record.mode==='inside')renderInside(record,asset);else renderDrawing(record,asset);}
 }
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(flush);}
 function flush(){
  queued=false;
  const ids=[...dirty];dirty.clear();const reads=[];
  for(const id of ids){const asset=assets.get(id);if(!asset)continue;stats.geometryPasses++;const read=measureAsset(asset);if(read)reads.push(read);else if(asset.viewport)asset.viewport.hidden=true;}
  for(const read of reads)writeAsset(read);
  for(const id of ids){const asset=assets.get(id);asset?.updateEditor?.();}
  labelsDirty=false;labelDirtyAssets.clear();
  positionInlineEditor();pollCanvas();
 }
 function invalidate(id){if(id){dirty.add(id);labelDirtyAssets.add(id);}else for(const key of assets.keys()){dirty.add(key);labelDirtyAssets.add(key);}labelsDirty=true;schedule();}
 function layout(record,asset){
  const b=record.geometry.textBounds??record.geometry.bounds,scale=asset.measured.img.width/asset.info.descriptor.width;
  const key=JSON.stringify([record.text,b.x,b.y,b.width,b.height,scale,record.style,fontVersion,record.geometry.bands,record.message.appearance?.fontSize]);
  if(layouts.has(key))return layouts.get(key);
  canvas??=document.createElement('canvas');const ctx=canvas.getContext('2d');
  const result=textLayout.fitRegionText(record.text,b,(t,size)=>{ctx.font=textLayout.fontCss(record.style,size);return ctx.measureText(t).width;},record.style,scale,record.geometry.bands,record.message.appearance?.fontSize);
  stats.textFits++;layouts.set(key,result);if(layouts.size>512)layouts.delete(layouts.keys().next().value);return result;
 }
 function paintSvg(parent,commands){
  for(const command of commands){
   if(command.type==='image')parent.append(svg('image',{x:command.x,y:command.y,width:command.width,height:command.height,href:command.dataUrl,preserveAspectRatio:'none'}));
   else if(command.type==='path')parent.append(svg('path',{d:command.path,...(command.stroke?{fill:'none',stroke:command.stroke,'stroke-width':command.width,'stroke-linecap':'round','stroke-linejoin':'round'}:{fill:command.fill})}));
   else if(command.type==='rect')parent.append(svg('rect',{x:command.x,y:command.y,width:command.width,height:command.height,fill:command.fill}));
   else if(command.type==='circle')parent.append(svg('circle',{cx:command.cx,cy:command.cy,r:command.r,fill:command.fill}));
  }
 }
 function drawingGroup(record){
  const edits=record.message.drawingEdits??record.region.drawingEdits??[];
  if(!edits.length)return null;
  const b=record.region.bounds,group=svg('g'),clipId='manga-draw-'+(++serial),defs=svg('defs'),clip=svg('clipPath',{id:clipId,clipPathUnits:'userSpaceOnUse'});
  clip.append(svg('rect',{x:b.x,y:b.y,width:b.width,height:b.height}));defs.append(clip);group.append(defs);
  const paints=svg('g',{'clip-path':'url(#'+clipId+')'});
  paintSvg(paints,textLayout.drawingCommands(edits,b,record.geometry.background??record.message.background));group.append(paints);return group;
 }
 function renderDrawing(record,asset){
  record.paintNode?.remove();record.paintNode=undefined;
  if(!asset.layer||!asset.measured)return;
  const group=drawingGroup(record);if(group){asset.layer.append(group);record.paintNode=group;}
 }
 function renderInside(record,asset){
  if(!asset.layer||!asset.measured)return;
  const fit=layout(record,asset);if(!fit)return;
  const key=JSON.stringify([record.text,record.style,record.geometry,record.message.eraseBoxes,record.message.eraseGeometry,record.message.drawingEdits,fit.fontSize,fit.lines]);
  if(record.node?.parentNode===asset.layer&&record.renderKey===key){displayState(record,'ready');return;}
  record.node?.remove();
  const b=record.geometry.bounds,group=svg('g',{'data-region-id':record.id}),defs=svg('defs'),clipId='manga-clip-'+(++serial),clip=svg('clipPath',{id:clipId,clipPathUnits:'userSpaceOnUse'});
  if(record.geometry.clipPath)clip.append(svg('path',{d:record.geometry.clipPath}));else clip.append(svg('rect',{x:b.x,y:b.y,width:b.width,height:b.height}));
  defs.append(clip);group.append(defs);
  const paints=svg('g',{'clip-path':'url(#'+clipId+')'}),m=record.message;
  const plan=textLayout.paintCommands({...record.region,...m},record.geometry,features.textCleanup);record.eraseMode=plan.mode;paintSvg(paints,plan.commands);
  const drawing=drawingGroup(record);if(drawing)paints.append(drawing);
  const position=textLayout.textPosition(b,fit,record.style.align);
  const text=svg('text',{'font-family':textLayout.fontCss(record.style,1).replace(/^600 1px /,''),'font-weight':600,'font-size':fit.fontSize,
   'text-anchor':position.anchor,direction:record.region.targetDirection==='rtl'?'rtl':'ltr',fill:record.style.color??textLayout.safeColor(m.appearance?.color??record.geometry.textColor??m.textColor,'#171717'),stroke:m.appearance?.outlined?textLayout.safeColor(m.appearance.strokeColor,'#fff'):'none','stroke-width':m.appearance?.outlined?fit.fontSize*.08:0,'paint-order':'stroke fill','stroke-linejoin':'round'});
  fit.lines.forEach((line,i)=>{const span=svg('tspan',{x:line.x??position.x,y:line.y??position.top+fit.fontSize*.83+i*fit.lineHeight});span.textContent=line.text;text.append(span);});
  const hit=svg('rect',{x:b.x,y:b.y,width:b.width,height:b.height,fill:'transparent',class:'translation-hit',tabindex:0,role:'button','aria-label':record.region.number+'. çeviriyi düzenle','data-region-id':record.id});
  hit.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();openInlineEditor(record);});
  hit.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key==='F2'){e.preventDefault();e.stopPropagation();openInlineEditor(record);}});
  if(record.geometry.angle)text.setAttribute('transform','rotate('+record.geometry.angle+' '+(b.x+b.width/2)+' '+(b.y+b.height/2)+')');
  paints.append(text);group.append(paints,hit);asset.layer.append(group);
  record.node=group;record.hit=hit;record.fit=fit;record.renderKey=key;
  displayState(record,'ready');
 }
 function labelAnchor(asset,region){
  const p=asset.measured.img,d=asset.info.descriptor,b=region.bounds;
  return {left:p.left+b.x/d.width*p.width,top:p.top+b.y/d.height*p.height,width:b.width/d.width*p.width,height:b.height/d.height*p.height};
 }
 function rootBounds(root){
  const viewportRoot=root.parent===document.documentElement;
  const width=root.host.clientWidth||root.parent.clientWidth;
  const height=viewportRoot?Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0):Math.max(root.parent.scrollHeight,root.parent.clientHeight);
  return {left:8,top:0,width:Math.max(1,width-16),height:Math.max(1,height)};
 }
 function positionInlineEditor(){
  if(!inlineEditor)return;
  const {record,element}=inlineEditor,asset=assets.get(record.assetId);
  if(!asset?.measured||!asset.root||!records.has(record.id)){closeInlineEditor(false);return;}
  const anchor=labelAnchor(asset,{bounds:record.geometry.bounds??record.region.bounds}),bounds=rootBounds(asset.root);
  element.style.left=Math.max(bounds.left,Math.min(anchor.left,bounds.left+bounds.width-316))+'px';
  element.style.top=Math.max(bounds.top,anchor.top)+'px';
 }
 function closeInlineEditor(focus=true){
  const current=inlineEditor;if(!current)return;inlineEditor=undefined;current.element.remove();
  if(focus)(current.record.hit??current.record.label?.querySelector('[data-region-id="'+CSS.escape(String(current.record.id))+'"]'))?.focus({preventScroll:true});
 }
 function emitEdit(record,previousText,isUndo=false){
  assets.get(record.assetId)?.onEdit?.({regionId:record.id,text:record.text,previousText,
   revision:record.region.revision||0,editRevision:record.region.editRevision||0,
   textStyle:{...record.style},drawingEdits:record.message.drawingEdits??record.region.drawingEdits??[],isUndo});
 }
 function commitEdit(record,text,undo=true){
  text=text.trim();if(!text||text.length>20000)throw Error('Çeviri boş olamaz ve 20.000 karakteri aşamaz.');
  if(text===record.text)return;
  const previousText=record.text;
  if(undo){record.undo.push(record.text);if(record.undo.length>20)record.undo.shift();}
  record.text=text;record.message={...record.message,text};
  record.region.editRevision=(record.region.editRevision||0)+1;record.message.editRevision=record.region.editRevision;
  record.region.turkish=text;record.region.targetText=text;record.renderKey=undefined;
  const asset=assets.get(record.assetId);if(record.mode==='inside'&&asset)renderInside(record,asset);else notify(record.assetId);
  emitEdit(record,previousText,!undo);
 }
 function openInlineEditor(record){
  const asset=assets.get(record.assetId);if(!asset?.root||!asset.measured)return false;
  closeInlineEditor(false);
  const element=document.createElement('div');element.className='inline-editor';element.setAttribute('role','dialog');element.setAttribute('aria-label','Çeviriyi düzenle');
  const input=document.createElement('textarea');input.value=record.text;input.maxLength=20000;input.setAttribute('aria-label','Çeviri metni');
  const hint=document.createElement('p');hint.textContent='Enter: kaydet · Shift+Enter: yeni satır · Esc: iptal';
  const status=document.createElement('p');status.setAttribute('role','status');
  const save=document.createElement('button');save.type='button';save.textContent='Kaydet';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='İptal';
  const submit=()=>{try{commitEdit(record,input.value);closeInlineEditor();}catch(error){status.textContent=error.message;input.setAttribute('aria-invalid','true');input.focus();}};
  save.addEventListener('click',submit);cancel.addEventListener('click',()=>closeInlineEditor());
  input.addEventListener('keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeInlineEditor();}
   else if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();event.stopPropagation();submit();}
  });
  element.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeInlineEditor();}});
  element.addEventListener('pointerdown',event=>event.stopPropagation());element.append(input,hint,save,cancel,status);asset.root.shadow.append(element);
  inlineEditor={record,element,input};positionInlineEditor();input.focus({preventScroll:true});input.select();return true;
 }
 function pollCanvas(){
  const ids=[...new Set([...records.values()].map(r=>r.assetId))].filter(id=>assets.get(id)?.info?.descriptor?.kind==='canvas'&&assets.get(id)?.image?.isConnected);
  if(!ids.length||document.hidden){clearTimeout(canvasTimer);canvasTimer=undefined;return;}
  if(canvasTimer)return;
  canvasTimer=setTimeout(()=>{canvasTimer=undefined;for(const id of ids)if(assets.has(id))invalidate(id);},350);
 }
 const resizeObserver=new ResizeObserver(()=>invalidate());
 const mutationObserver=new MutationObserver(mutations=>{
  if(mutations.some(m=>{
   if(own(m.target))return false;
   if(m.type==='attributes')return [...assets.values()].some(a=>a.image&&(m.target===a.image||m.target.contains(a.image)));
   return [...m.addedNodes,...m.removedNodes].some(n=>n.nodeType===1&&!own(n));
  }))invalidate();
 });
 mutationObserver.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset','style','class']});
 // Native scrolling moves the layers. Only visible editing handles need JS updates.
 window.addEventListener('scroll',()=>{stats.scrollEvents++;if(editorViews.size||inlineEditor)requestAnimationFrame(()=>{for(const id of editorViews)assets.get(id)?.updateEditor?.();positionInlineEditor();});}, {capture:true,passive:true});
 window.addEventListener('resize',()=>invalidate(),{passive:true});
 window.visualViewport?.addEventListener('resize',()=>invalidate(),{passive:true});
 window.addEventListener('popstate',()=>invalidate());
 window.addEventListener('hashchange',()=>invalidate());
 window.navigation?.addEventListener('currententrychange',()=>invalidate());
 document.fonts?.addEventListener('loadingdone',()=>{fontVersion++;layouts.clear();invalidate();});
 void textLayout.prepareFonts().then(loaded=>{if(loaded){fontVersion++;layouts.clear();invalidate();}});
 document.addEventListener('visibilitychange',()=>invalidate());
 const api={
  register(id,read,updateEditor,onDisplay,onEdit){let asset=assets.get(id);if(!asset){asset={id};assets.set(id,asset);}asset.read=read;asset.updateEditor=updateEditor;asset.onDisplay=onDisplay;asset.onEdit=onEdit;invalidate(id);},
  editor(id,visible){if(visible)editorViews.add(id);else editorViews.delete(id);},
  invalidate,
  updateNumber(id,number){const a=assets.get(id);if(a?.info)a.info.descriptor.displayIndex=number;notify(id);},
  beginSession(id){if(!id||cancelledSessions.has(id))return {ok:false,reason:'Durdurulmuş yerleştirme oturumu.'};activeSession=id;return {ok:true};},
  cancelSession(id){if(id){cancelledSessions.add(id);if(activeSession===id)activeSession=undefined;}return {ok:true};},
  acceptsSession(id){return !id||id===activeSession&&!cancelledSessions.has(id);},
  show(assetId,region,message){
   if(!api.acceptsSession(message.layoutSession))return {ok:false,reason:'İşlem durduruldu; geç çeviri uygulanmadı.'};
   const asset=assets.get(assetId);if(!asset)return {ok:false,reason:'Görsel katmanı bulunamadı.'};
   if(typeof message.text!=='string'||!message.text.trim()||message.text.length>20000)return {ok:false,reason:'Çeviri metni boş veya fazla uzun.'};
   const previous=records.get(region.id);
   if(inlineEditor?.record.id===region.id)return {ok:false,reason:'Metin düzenleniyor; geç çeviri uygulanmadı.'};
   if((previous?.region.editRevision??0)>(message.editRevision??region.editRevision??0))return {ok:false,reason:'Metin düzenlendi; geç çeviri uygulanmadı.'};
   if(message.revision!==undefined&&message.revision!==(region.revision||0))return {ok:false,reason:'Alan değişti; geç sonuç uygulanmadı.'};
   if(message.editRevision!==undefined&&message.editRevision!==(region.editRevision||0))return {ok:false,reason:'Metin düzenlendi; geç çeviri uygulanmadı.'};
   if(dirty.has(assetId)||!asset.measured){const read=measureAsset(asset);writeAsset(read);dirty.delete(assetId);}if(asset.failure)return {ok:false,mode:'unavailable',reason:asset.failure};
   let geometry;
   try{geometry=textLayout.inplaceGeometry({...region,...message,bounds:region.bounds},asset.info.descriptor.width,asset.info.descriptor.height);textLayout.drawingCommands(message.drawingEdits??region.drawingEdits??[],region.bounds,geometry.background);}
   catch(error){return {ok:false,reason:error.message};}
   const fallbackReason=message.cleanupPatch?.warning;
   api.hide(region.id);
   const record={id:region.id,assetId,sessionId:message.layoutSession,region:{...region,bounds:{...region.bounds}},text:message.text.trim(),message,geometry,fallbackReason,
    style:textLayout.resolvedTextStyle(message.textStyle??region.textStyle,message.appearance),undo:previous?.undo??[],mode:geometry.mode==='inside'?'inside':'label'};
   records.set(record.id,record);
   displayState(record,asset.measured?'pending':'waiting-for-image');
   if(record.mode==='inside'&&asset.measured)renderInside(record,asset);
   if(record.mode==='label'){renderDrawing(record,asset);notify(record.assetId);}pollCanvas();return {ok:true,mode:record.mode,state:record.state,fallbackReason};
  },
  async whenRendered(id){
   await new Promise(resolve=>{const timer=setTimeout(resolve,150);requestAnimationFrame(()=>{clearTimeout(timer);resolve();});});
   if(queued)flush();
   const record=records.get(id);if(!record)return {ok:false,reason:'Çeviri kaldırıldı; geç sonuç uygulanmadı.'};
   if(record.state==='pending')return {ok:false,reason:'Çeviri katmanı oluşturulamadı.'};
   return {ok:true,mode:record.mode,state:record.state,fallbackReason:record.fallbackReason};
  },
  edit(id){const record=records.get(id);return {ok:Boolean(record&&openInlineEditor(record))};},
  undoEdit(id){const record=records.get(id);if(!record?.undo.length)return {ok:false,reason:'Geri alınacak düzenleme yok.'};closeInlineEditor(false);commitEdit(record,record.undo.pop(),false);return {ok:true};},
  snapshot(assetId){return [...records.values()].filter(r=>!assetId||r.assetId===assetId).map(r=>{
   const m=r.message;
   return {...r.region,text:r.text,targetText:r.text,turkish:r.text,textStyle:{...r.style},renderStyle:{...r.style},displayGeometry:r.geometry,
    renderLayout:r.fit?structuredClone(r.fit):undefined,eraseBoxes:m.eraseBoxes,eraseGeometry:m.eraseGeometry,ocrBounds:m.ocrBounds,cleanupPatch:m.cleanupPatch,appearance:m.appearance,erasePolygons:m.erasePolygons,
    imageWidth:m.imageWidth,imageHeight:m.imageHeight,drawingEdits:structuredClone(m.drawingEdits??r.region.drawingEdits??[])};
  });},
  hide(id){const r=records.get(id);if(inlineEditor?.record.id===id)closeInlineEditor(false);r?.node?.remove();r?.paintNode?.remove();records.delete(id);if(r?.mode==='label')notify(r.assetId);pollCanvas();},
  hideAll(){closeInlineEditor(false);clearTimeout(canvasTimer);canvasTimer=undefined;if(activeSession)api.cancelSession(activeSession);for(const r of records.values()){r.node?.remove();r.paintNode?.remove();}records.clear();layouts.clear();labelDirtyAssets.clear();for(const root of roots.values()){for(const b of root.boxes)b.element.remove();root.boxes=[];}},
  removeAsset(id){for(const r of [...records.values()])if(r.assetId===id)api.hide(r.id);const asset=assets.get(id);if(!asset)return;attach(asset,null);assets.delete(id);editorViews.delete(id);dirty.delete(id);},
  rects(assetId){return [...records.values()].filter(r=>r.mode==='inside'&&(!assetId||r.assetId===assetId)&&r.hit?.isConnected&&!assets.get(r.assetId)?.viewport.hidden).map(r=>{const b=r.hit.getBoundingClientRect();return {id:r.id,left:b.left,top:b.top,width:b.width,height:b.height,fontSize:r.fit?.fontSize,text:r.text,displayBounds:r.geometry.bounds};});},
  labels(assetId){return [...records.values()].filter(r=>r.mode==='label'&&(!assetId||r.assetId===assetId)).length;},
  state(){return {stats:{...stats},roots:roots.size,assets:assets.size,editing:inlineEditor?{id:inlineEditor.record.id,text:inlineEditor.input.value}:null,labels:[...roots.values()].flatMap(r=>r.boxes.map(b=>{const p=b.element.getBoundingClientRect();return {ids:b.ids,grouped:b.grouped,text:b.element.textContent,left:p.left,top:p.top,width:p.width,height:p.height};})),records:[...records.values()].map(r=>({id:r.id,assetId:r.assetId,mode:r.mode,eraseMode:r.eraseMode,state:r.state,fallbackReason:r.fallbackReason,text:r.text,textStyle:r.style,editRevision:r.region.editRevision??0,canUndo:Boolean(r.undo.length),fontSize:r.fit?.fontSize,displayBounds:r.geometry.bounds,glyphBounds:glyphBounds(r)}))};}
 };
 globalThis.__mangaOverlayManager=api;
})();
