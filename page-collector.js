(() => {
 if(globalThis.__mangaPageCollector)return;
 function createCollector(scope,hooks={}){
 const document=scope.document,location=scope.location,window=scope.window;
 const getComputedStyle=scope.getComputedStyle.bind(scope);
 const nodes=new Map(),ids=new WeakMap();let sequence=0,cancelled=false,collecting=false,collectionAbort;
 const reads=new Set();let activeSession,viewportTimer;
 let helper;
 const snapshots=new Map(),imageContents=new WeakMap();let sourceCache,cacheName;
 let resolvedPages=[],resolvedChapter;
 const sourcePath=url=>{try{return new URL(url).pathname.match(/\/data(?:-saver)?\/[a-f\d]{32,64}\/[^/]+$/i)?.[0];}catch{return;}};
 async function chapterSources(signal){
  const chapter=location.href.match(/\/chapter\/([a-f\d-]{36})(?:[/?#]|$)/i)?.[1];if(!chapter)return [];
  const resource=scope.performance?.getEntriesByType('resource').find(entry=>{
   try{const u=new URL(entry.name);return u.pathname.toLowerCase()==='/at-home/server/'+chapter.toLowerCase()&&(u.origin===location.origin||u.hostname==='api.mangadex.org'&&/(^|\.)mangadex\.org$/.test(location.hostname));}catch{return false;}
  });
  if(!resource)return [];
  try{
   // Reuse metadata already requested by this chapter; never guess neighbouring pages.
   const response=await scope.fetch(resource.name,{credentials:'same-origin',cache:'force-cache',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
   if(!response.ok||Number(response.headers.get('content-length'))>2_000_000)return [];
   const text=await response.text();if(text.length>2_000_000)return [];
   const value=JSON.parse(text),chapter=value.chapter,base=new URL(value.baseUrl);
   if(!/^https?:$/.test(base.protocol)||base.username||base.password||!chapter||!/^[a-f\d]{32,64}$/i.test(chapter.hash))return [];
   const current=choose(candidates()).map(v=>v.descriptor.imageUrl),saver=current.some(url=>sourcePath(url)?.startsWith('/data-saver/'));
   const files=saver?chapter.dataSaver:chapter.data;
   if(!Array.isArray(files)||!files.length||files.length>10000||files.some(file=>typeof file!=='string'||!file||/[\\/?#]/.test(file)||file==='.'||file==='..'))return [];
   return files.map(file=>{const suffix='/'+(saver?'data-saver':'data')+'/'+chapter.hash+'/'+encodeURIComponent(file);return current.find(url=>sourcePath(url)===suffix)||base.href.replace(/\/$/,'')+suffix;});
  }catch(error){if(signal.aborted)throw new DOMException('Tarama durduruldu.','AbortError');return [];}
 }
 async function clearSnapshots(){const name=cacheName;snapshots.clear();sourceCache=undefined;cacheName=undefined;if(name)await scope.caches.delete(name);}
 async function snapshot(asset,result,check){
  check();
  if(!result?.ok||!result.dataUrl)throw Error(result?.reason||'Arka plandaki görsel okunamadı.');
  if(snapshots.has(asset.imageUrl))return;
  cacheName??='manga-cevirmen-sources-'+crypto.randomUUID();sourceCache??=scope.caches.open(cacheName);
  const key=new URL('/.manga-cevirmen-source/'+asset.assetId,location.origin).href;
  const cache=await sourceCache;check();const response=await fetch(result.dataUrl);check();await cache.put(key,response);check();snapshots.set(asset.imageUrl,key);
 }
 const canvasContents=new WeakMap();
 function canvasFingerprint(canvas,fresh=false){
  if(!canvas.width||!canvas.height||canvas.width*canvas.height>40_000_000)return null;
  idFor(canvas);
  const prior=canvasContents.get(canvas),now=Date.now();
  if(!fresh&&prior&&now-prior.time<250)return prior.value;
  try{
   const data=canvas.toDataURL('image/png');let a=2166136261,b=5381;
   for(let i=0;i<data.length;i++){a=Math.imul(a^data.charCodeAt(i),16777619);b=Math.imul(b,33)^data.charCodeAt(i);}
   const value=canvas.width+'x'+canvas.height+':'+(a>>>0).toString(16)+':'+(b>>>0).toString(16);
   canvasContents.set(canvas,{time:now,value});return value;
  }catch{return null;}
 }
 function isCurrent(descriptor,fresh=false){
  if(snapshots.has(descriptor.imageUrl))return true;
  if(descriptor.kind!=='canvas'||!descriptor.canvasFingerprint)return true;
  const canvas=nodes.get(descriptor.nodeId)?.deref();
  return !canvas?.isConnected||canvasFingerprint(canvas,fresh)===descriptor.canvasFingerprint;
 }
 function sourceFingerprint(el){
  if(el.tagName==='CANVAS')return canvasFingerprint(el,true);
  const src=el.currentSrc||el.src;
  if(!src?.startsWith('blob:')||!el.complete||!el.naturalWidth||el.naturalWidth*el.naturalHeight>40_000_000)return;
  const prior=imageContents.get(el);if(prior?.src===src)return prior.value;
  try{
   const canvas=document.createElement('canvas');canvas.width=el.naturalWidth;canvas.height=el.naturalHeight;canvas.getContext('2d').drawImage(el,0,0);
   const value=canvasFingerprint(canvas,true);imageContents.set(el,{src,value});return value;
  }catch{return;}
 }
 const absolute=(value,base=location.href)=>{try{return new URL(value,base).href;}catch{return '';}};
 function pageKey(href=location.href){
  const u=new URL(href);
  const normalize=path=>path.replace(/(\/chapter\/[0-9a-f-]{36})\/\d+\/?$/i,'$1').replace(/(\/(?:c\d+[a-z]?|chapter[-_]\d+))\/\d+(?:\.html)?\/?$/i,'$1').replace(/\/page[-/]\d+\/?$/i,'');
  const keys=['page','pg','pageNumber','page_number'];
  // WordPress uses ?p=POST_ID for chapter identity. Treat short p as a page
  // only when a chapter is already identified by the path or another query.
  if(/\/chapter(?:\/|[-_])|\/c\d+/i.test(u.pathname)||u.searchParams.has('chapter')||u.searchParams.has('chapterId'))keys.push('p');
  const hash=u.hash.slice(1);
  if(hash.startsWith('/')){const route=new URL(hash,u.origin);for(const k of keys)if(/^\d+$/.test(route.searchParams.get(k)||''))route.searchParams.delete(k);route.searchParams.sort();route.pathname=normalize(route.pathname);u.hash=route.pathname+route.search;}
  else if(/^(?:page[=:]?\d+|\d+)?$/i.test(hash))u.hash='';
  for(const key of keys)if(/^\d+$/.test(u.searchParams.get(key)||''))u.searchParams.delete(key);u.searchParams.sort();
  u.pathname=normalize(u.pathname);return u.href;
 }
 function excluded(el){
  if(el.closest('nav,header,footer,aside,button,template,[aria-hidden=true]'))return true;
  for(let p=el;p&&p!==document.body;p=p.parentElement){
   const name=((p.id||'')+' '+(typeof p.className==='string'?p.className:'')+' '+(p.getAttribute('aria-label')||'')).replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase();
   if(/adsbygoogle|google[_-]?ads|doubleclick|adsterra|adslot|ad[-_]?container|(^|[\s_-])(ads?|advert(?:isement|ising)?|sponsor(?:ed)?|recommend(?:ed|ation|ations)?|related|thumbnail|avatar|logo|banner|toolbar)([\s_-]|$)/.test(name))return true;
  }
  return false;
 }
 function imageUrl(el,base=location.href){
  let actual=el.currentSrc||el.getAttribute('src')||'';
  const lazy=el.getAttribute('data-url')||el.getAttribute('data-src')||el.getAttribute('data-original')||el.getAttribute('data-lazy-src')||'';
  const placeholder=/transparent|transparency|placeholder|loading|blank|spacer/i.test(actual)||(el.naturalWidth>0&&el.naturalWidth<10);
  if(el.naturalWidth>0&&el.naturalWidth<10)actual=el.getAttribute('src')||actual;
  let value=lazy && (placeholder||!actual)?lazy:actual||lazy;
  if(!value){const set=el.getAttribute('data-srcset')||el.getAttribute('srcset');if(set)value=set.split(',').at(-1).trim().split(/\s+/)[0];}
  return absolute(value,base);
 }
 function idFor(el){if(!ids.has(el)){const id='page-node-'+(++sequence);ids.set(el,id);nodes.set(id,new WeakRef(el));}return ids.get(el);}
 function findNode(descriptor){
  let el=(nodes.get(descriptor.nodeId)||nodes.get(descriptor.assetId))?.deref();
  const samePosition=(e,bound)=>{const selects=descriptor.readerIndex?pageSelectors():[];return selects.length===1?selects[0].selectedIndex+1===descriptor.readerIndex:bound||descriptor.position===undefined||Math.abs(contentPosition(e,e.getBoundingClientRect())-descriptor.position)<2;};
  const matches=(e,bound=false)=>e?.isConnected && (descriptor.kind==='canvas'?e.tagName==='CANVAS'&&canvasFingerprint(e,true)===descriptor.canvasFingerprint&&samePosition(e,bound):descriptor.kind==='background'?
   absolute(getComputedStyle(e).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1]||'')===descriptor.imageUrl:imageUrl(e)===descriptor.imageUrl||Boolean(descriptor.sourcePath&&sourcePath(imageUrl(e))===descriptor.sourcePath)||Boolean(descriptor.sourceFingerprint&&sourceFingerprint(e)===descriptor.sourceFingerprint&&samePosition(e,bound)));
  if(matches(el,true))return el;
  if(descriptor.kind==='image'||descriptor.kind==='canvas')for(const candidate of document.querySelectorAll(descriptor.kind==='canvas'?'canvas':'img'))if(matches(candidate)){nodes.set(descriptor.assetId||descriptor.nodeId,new WeakRef(candidate));return candidate;}
  return null;
 }
 function candidates(doc=document,base=location.href,live=true){
  const result=[];
  for(const el of doc.querySelectorAll('img,canvas')){
   if(excluded(el))continue;
   const r=live?el.getBoundingClientRect():null;
   // Hidden templates and previews are not reader pages; offscreen pages retain size.
   if(live&&(!r.width||!r.height||getComputedStyle(el).visibility==='hidden'))continue;
   const declaredW=Number(el.getAttribute('width'))||0,declaredH=Number(el.getAttribute('height'))||0;
   const nw=el.tagName==='CANVAS'?el.width:el.naturalWidth||0,nh=el.tagName==='CANVAS'?el.height:el.naturalHeight||0;
   const width=Math.max(nw>10?nw:0,declaredW,r?.width||0),height=Math.max(nh>10?nh:0,declaredH,r?.height||0);
   const remoteUnknown=!live&&!width&&!height&&Boolean(el.closest('main,article,[id*=reader],[class*=reader],[id*=chapter],[class*=chapter]'));
   const displayWidth=r?.width||declaredW||width||(remoteUnknown?600:0);
   if(!remoteUnknown&&(width<250||height<40||displayWidth<200||width*height<40_000))continue;
   const kind=el.tagName==='CANVAS'?'canvas':'image',nodeId=live?idFor(el):null;
   const fingerprint=kind==='canvas'?canvasFingerprint(el,true):undefined;
   const url=kind==='canvas'?fingerprint&&'canvas:'+location.href+'#'+nodeId+':'+fingerprint:imageUrl(el,base);
   if(!url)continue;
   if(kind==='image'&&nw>0&&nw<10&&url===absolute(el.currentSrc||el.getAttribute('src')||'',base))continue;
   result.push({el,descriptor:{assetId:crypto.randomUUID(),nodeId,imageUrl:url,sourcePath:sourcePath(url),canvasFingerprint:fingerprint,sourceFingerprint:kind==='canvas'?fingerprint:live?sourceFingerprint(el):undefined,width:Math.round(width),height:Math.round(height),kind,pageUrl:pageKey(),readerUrl:base,pageManaged:true,position:r?contentPosition(el,r):undefined},displayWidth});
  }
  return result;
 }
 function choose(list){
  if(!list.length)return [];
  const explicit=list.filter(v=>v.el.closest('#_imageList,[id*=reader],[class*=reader],[id*=chapter],[class*=chapter],[class*=reading],[id*=comic],[class*=comic]'));
  if(explicit.length)return explicit;
  const main=list.filter(v=>v.el.closest('main,article,[role=main]'));
  const pool=main.length?main:list;
  // A column of large similarly-sized page images wins over a small card grid.
  const groups=pool.map(v=>({width:v.displayWidth,items:pool.filter(a=>Math.abs(a.displayWidth-v.displayWidth)<=v.displayWidth*.18)}));
  groups.sort((a,b)=>b.items.reduce((s,v)=>s+v.descriptor.width*v.descriptor.height,0)-a.items.reduce((s,v)=>s+v.descriptor.width*v.descriptor.height,0));
  return groups[0].items;
 }
 function contentPosition(el,rect){
  let top=rect.top+scope.scrollY;
  for(let p=el.parentElement;p&&p!==document.scrollingElement;p=p.parentElement)top+=p.scrollTop;
  return Math.round(top);
 }
 function readerScroller(){
  const roots=new Map();
  for(const {el}of choose(candidates()))for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){
   if(p===document.scrollingElement)break;
   if(p.clientHeight>0&&p.scrollHeight>p.clientHeight+4&&/^(auto|scroll)$/.test(getComputedStyle(p).overflowY))roots.set(p,(roots.get(p)||0)+1);
  }
  // Ties retain the nearest scrolling ancestor rather than an outer document shell.
  return [...roots].sort((a,b)=>b[1]-a[1])[0]?.[0]||document.scrollingElement;
 }
 function pageSelectors(){
  return [...document.querySelectorAll('select')].filter(el=>{
   const name=[el.id,el.name,el.className,el.getAttribute('aria-label')].join(' ');
   return /page|pagination/i.test(name)&&!/chapter|episode|zoom|scale/i.test(name)&&el.options.length>1&&[...el.options].every(o=>/^\d+$/.test(o.value));
  });
 }
 function moveReader(root,left,top){
  if(root===document.scrollingElement)window.scrollTo({left,top,behavior:'instant'});
  else root.scrollTo({left,top,behavior:'instant'});
 }
 function embedded(doc,base){
  const found=[];
  const add=value=>{const url=absolute(value,base);if(/^https?:/.test(url)&&(/^https?:|^\//.test(value)||/\.(?:png|jpe?g|webp|avif|gif)(?:[?#]|$)/i.test(url)))found.push(url);};
  function walk(value,key='',depth=0,inPages=false){
   if(depth>10||/recommend|related|nextchapter|prevchapter|thumbnail|avatar|cover|^(?:next|previous|prev|chapters|episodes)$/i.test(key))return;
   const isPages=inPages||/^(?:pages|images|imagelist|chapterimages|readerimages|pageurls|sources)$/i.test(key);
   if(typeof value==='string'){if(isPages)add(value);return;}
   if(Array.isArray(value)){for(const item of value)walk(item,key,depth+1,isPages);return;}
   if(value&&typeof value==='object')for(const [k,v]of Object.entries(value))walk(v,k,depth+1,isPages);
  }
  for(const script of doc.querySelectorAll('script[type="application/json"],script[id="__NEXT_DATA__"]')){
   try{walk(JSON.parse(script.textContent));}catch{}
  }
  // Structured JSON was already walked with chapter exclusions above. Do not
  // rescan its nested nextChapter.pages array as an unrelated root page list.
  // JavaScript fallback accepts direct array assignments, never arbitrary nested keys.
  for(const script of doc.querySelectorAll('script:not([src]):not([type="application/json"]):not(#__NEXT_DATA__)')){
   for(const match of script.textContent.matchAll(/(?:^|[;\r\n])\s*(?:(?:const|let|var)\s+)?(?:(?:window|globalThis)\.)?(?:pages|pageUrls|chapterImages|readerImages|imageList)\s*=\s*(\[[^\]]{1,200000}\])/gi)){
    try{walk(JSON.parse(match[1]),'pages');}catch{}
   }
  }
  if(doc===document&&resolvedChapter===pageKey())found.push(...resolvedPages);
  return [...new Set(found)];
 }
 function links(doc=document,base=location.href){
  const output=new Set();
  for(const el of doc.querySelectorAll('a[href],select option[value]')){
   const labelText=[el.textContent,el.getAttribute('aria-label'),el.getAttribute('title')].join(' ');
   if(/(?:next|previous|prev)\s*(?:chapter|chap\.?|episode)|(?:sonraki|önceki)\s*bölüm/i.test(labelText))continue;
   const value=el.getAttribute('href')||el.getAttribute('value'),url=absolute(value,base);
   if(!/^https?:/.test(url)||pageKey(url)!==pageKey(base)||url.split('#')[0]===base.split('#')[0])continue;
   const u=new URL(url),label=(el.textContent||'').trim();
   if(['page','p','pg','pageNumber','page_number'].some(k=>u.searchParams.has(k))||/\/page\/\d+|\/chapter\/[0-9a-f-]{36}\/\d+/i.test(u.pathname)||/^\d+$/.test(label))output.add(url);
  }
  return [...output];
 }
 function backgroundCandidates(){
  const result=[];
  for(const el of document.querySelectorAll('main div,article div,[id*=reader] div,[class*=reader] div,[class*=chapter] div')){
   if(excluded(el))continue;const r=el.getBoundingClientRect();if(r.width<250||r.height<300)continue;
   const raw=getComputedStyle(el).backgroundImage,match=raw.match(/^url\(["']?(.*?)["']?\)$/);
   if(!match)continue;const imageUrl=absolute(match[1]),nodeId=idFor(el);
   result.push({assetId:crypto.randomUUID(),nodeId,imageUrl,kind:'background',width:0,height:0,pageUrl:pageKey(),readerUrl:location.href,pageManaged:true});
  }
  return result;
 }
 function preview(){
  const list=choose(candidates()).map(v=>v.descriptor),extra=embedded(document,location.href);
  for(const imageUrl of extra)if(!list.some(a=>a.imageUrl===imageUrl))list.push({assetId:crypto.randomUUID(),nodeId:null,imageUrl,kind:'image',width:0,height:0,pageUrl:pageKey(),readerUrl:location.href,pageManaged:true});
  list.push(...backgroundCandidates());
  const frames=[...document.querySelectorAll('iframe[src]')].filter(e=>!excluded(e)&&e.getBoundingClientRect().width>=250&&e.getBoundingClientRect().height>=300).map(e=>absolute(e.src));
  const origins=[...new Set([...list.map(a=>a.imageUrl),...frames].filter(u=>/^https?:/.test(u)).map(u=>new URL(u).origin+'/*'))];
  return {ok:true,assets:list,origins,frames,pageUrl:pageKey(),readerUrl:location.href};
 }
 const delay=(ms,signal=collectionAbort?.signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new DOMException('Durduruldu.','AbortError'));return;}
  const abort=()=>{clearTimeout(timer);reject(new DOMException('Durduruldu.','AbortError'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});
 });
 function cancel(){activeSession=undefined;clearTimeout(viewportTimer);cancelled=true;collectionAbort?.abort();helper?.collector?.cancel();helper?.restoreFocus();helper?.frame.remove();helper=undefined;for(const controller of reads)controller.abort();}
 async function collect(options={}){
  if(collecting)throw Error('Sayfa zaten hazırlanıyor.');
  collecting=true;cancelled=false;const controller=new AbortController();collectionAbort=controller;
  const session={id:options.sessionId||crypto.randomUUID(),pageKey:pageKey()};activeSession=session;publishViewport();
  const scrollRoot=readerScroller(),initial={x:scope.scrollX,y:scope.scrollY,left:scrollRoot.scrollLeft,top:scrollRoot.scrollTop},key=pageKey(),found=new Map(),pages=new Set([location.href]);
  const selects=pageSelectors(),selectExpected=selects.length===1?selects[0].options.length:null,visited=new Set();
  let userMoved=false,scrollEvents=0,incomplete=false,backgroundDiscovery;const declared=embedded(document,location.href),knownOrder=new Map(declared.map((u,i)=>[u,i]));
  function discovery(){
   const expectedCount=pages.size===1?(knownOrder.size||selectExpected||null):null;
   const countMatches=expectedCount===null?null:found.size===expectedCount&&[...knownOrder.keys()].every(url=>found.has(url));
   const selected=hooks.background&&selectExpected&&visited.size===selectExpected&&found.size===selectExpected;
   return {expectedCount:expectedCount??backgroundDiscovery?.expectedCount??null,foundCount:found.size,countMatches,
    complete:knownOrder.size>0&&countMatches===true||Boolean(selected)||Boolean(backgroundDiscovery?.complete),coverage:knownOrder.size?'listed':selected?'selected':backgroundDiscovery?.coverage??'unverified'};
  }
  const userInput=event=>{if(event.type!=='keydown'||/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/.test(event.key)&&!event.target.closest?.('input,textarea,select,[contenteditable=true]'))userMoved=true;};
  for(const type of ['wheel','touchstart','pointerdown','keydown'])window.addEventListener(type,userInput,{passive:true});
  function verify(){if(controller.signal.aborted||activeSession!==session)throw new DOMException('Tarama durduruldu.','AbortError');if(pageKey()!==key)throw Error('Manga bölümü değişti.');}
  function gather(doc=document,base=location.href,live=true){
   const selected=choose(candidates(doc,base,live)).map(v=>v.descriptor),listed=embedded(doc,base);
   if(live&&selected.length===1&&selects.length===1){const index=selects[0].selectedIndex+1;selected[0].readerIndex=index;if(hooks.background)visited.add(index);}
   if(live&&listed.length){knownOrder.clear();listed.forEach((url,index)=>knownOrder.set(url,index));}
   for(const imageUrl of listed)selected.push({assetId:crypto.randomUUID(),nodeId:null,imageUrl,sourcePath:sourcePath(imageUrl),kind:'image',width:0,height:0,pageUrl:key,readerUrl:base,pageManaged:true});
   if(live)selected.push(...backgroundCandidates());
   merge(selected);
  }
  function existingAsset(asset){
   const direct=found.get(asset.imageUrl)||[...found.values()].find(prior=>asset.sourcePath&&prior.sourcePath===asset.sourcePath);if(direct)return direct;
   if(!asset.sourceFingerprint)return;
   const matches=[...found.values()].filter(prior=>prior.kind===asset.kind&&prior.sourceFingerprint===asset.sourceFingerprint);
   const bound=asset.nodeId&&matches.find(prior=>(nodes.get(prior.nodeId)||nodes.get(prior.assetId))?.deref()===nodes.get(asset.nodeId)?.deref());
   return !hooks.background&&bound?bound:matches.find(prior=>asset.readerIndex?prior.readerIndex===asset.readerIndex:prior.position===asset.position);
  }
  activeSession.resolve=asset=>existingAsset(asset)?.imageUrl;
  function merge(selected){
   let changed=false;
   for(const asset of selected){const existing=existingAsset(asset);if(!existing){found.set(asset.imageUrl,asset);changed=true;}else if(asset.nodeId){existing.position=asset.position;if(!findNode(existing)){existing.nodeId=asset.nodeId;changed=true;}}}
   if(changed)emit('PAGE_ASSETS_FOUND',{assets:orderedAssets()});
  }
  function orderedAssets(){
   return [...found.values()].sort((a,b)=>{
    const rank=v=>knownOrder.has(v.imageUrl)?knownOrder.get(v.imageUrl):v.readerIndex??v.position??Number.MAX_SAFE_INTEGER;
    return rank(a)-rank(b);
   }).map((a,i)=>({...a,index:i+1}));
  }
  // Keep the same asset ids when the visible reader later binds prepared pages.
  activeSession.refresh=()=>{verify();gather();emit('PAGE_DISCOVERY_UPDATED',{assets:orderedAssets(),discovery:discovery(),incomplete});};
  try{
   if(!hooks.background)await clearSnapshots();verify();
   resolvedPages=await chapterSources(controller.signal);verify();resolvedChapter=key;
   gather();const completeList=discovery().complete;
   if(!completeList&&!hooks.background){
    const frame=document.createElement('iframe');frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;frame.inert=true;
    frame.setAttribute('sandbox','allow-scripts allow-same-origin');
    frame.style.cssText='position:fixed;inset:0;border:0;opacity:0;pointer-events:none;z-index:-2147483648;width:'+scope.innerWidth+'px;height:'+scope.innerHeight+'px';
    let focused=document.activeElement;
    const rememberFocus=event=>{if(event.target!==frame)focused=event.target;};
    const restoreFocus=()=>{
     if(document.activeElement!==frame||!document.hasFocus()||!focused?.isConnected)return;
     if(frame.contentDocument?.documentElement)frame.contentDocument.documentElement.inert=true;
     const body=focused===document.body&&!focused.hasAttribute('tabindex');if(body)focused.tabIndex=-1;
     focused.focus({preventScroll:true});if(body)focused.removeAttribute('tabindex');
    };
    // shortcut: Older Chrome can fire one blur before focus returns; use the focus policy once broadly supported.
    const guardFocus=()=>queueMicrotask(()=>{if(helper?.frame===frame)restoreFocus();});
    document.addEventListener('focusin',rememberFocus);window.addEventListener('blur',guardFocus,true);
    helper={frame,restoreFocus};
    try{
     await new Promise((resolve,reject)=>{
      const signal=controller.signal;
      const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);frame.onload=null;frame.onerror=null;};
      const abort=()=>{cleanup();reject(new DOMException('Tarama durduruldu.','AbortError'));};
      const timer=setTimeout(()=>{cleanup();reject(Error('Görünmeyen okuyucu yüklenemedi.'));},15000);
      frame.onload=()=>{cleanup();resolve();};frame.onerror=()=>{cleanup();reject(Error('Site görünmeyen okuyucuya izin vermedi.'));};signal.addEventListener('abort',abort,{once:true});
      frame.src=location.href;document.body.append(frame);
     });
     verify();if(frame.contentWindow.location.origin!==location.origin||pageKey(frame.contentWindow.location.href)!==key)throw Error('Site görünmeyen okuyucuya izin vermedi.');
     frame.contentDocument.documentElement.inert=true;restoreFocus();
     let pending=Promise.resolve();const staged=new Set();
     const accept=assets=>{
      for(const source of assets){
       if(staged.has(source.imageUrl))continue;staged.add(source.imageUrl);
       const asset={...source,nodeId:null};
       if(/^https?:/.test(source.imageUrl)){merge([asset]);continue;}
       // Capture before a virtual reader repaints or removes this source node.
       const captured=collector.read(source);
       pending=pending.then(async()=>{const result=await captured;verify();const existing=existingAsset(asset);await snapshot(existing||asset,result,verify);verify();merge([asset]);});pending.catch(()=>{});
      }
     };
     const collector=createCollector(frame.contentWindow,{background:true,flush:()=>pending,emit:(type,extra)=>{
      verify();if(type==='PAGE_ASSETS_FOUND')accept(extra.assets);
      else if(type==='PAGE_COLLECTION_WARNING'||type==='PAGE_COLLECTION_PROGRESS')emit(type,extra);
     }});helper.collector=collector;
     const result=await collector.collect({sessionId:activeSession.id});accept(result.assets);await pending;verify();backgroundDiscovery=result.discovery;incomplete ||= result.incomplete;
    }finally{restoreFocus();document.removeEventListener('focusin',rememberFocus);window.removeEventListener('blur',guardFocus,true);helper?.collector?.cancel();frame.remove();helper=undefined;}
   }
   if(hooks.background&&!completeList){await hooks.flush?.();moveReader(scrollRoot,scrollRoot.scrollLeft,0);await delay(150);gather();}
   const started=performance.now();
   let stable=0,prior=-1;
   while(hooks.background&&!completeList&&stable<3){
    if(userMoved){incomplete=true;break;}
    verify();gather();await hooks.flush?.();
    const scroller=scrollRoot,viewport=scroller===document.scrollingElement?scope.innerHeight:scroller.clientHeight,bottom=scroller.scrollTop+viewport>=scroller.scrollHeight-4;
    if(bottom&&prior===found.size)stable++;else stable=0;
    prior=found.size;
    if(performance.now()-started>120000)throw Error('Sayfanın yüklenmesi tamamlanmadı. Bulunan görselleri yeniden deneyebilirsin.');
    if(!bottom)moveReader(scroller,scroller.scrollLeft,Math.min(scroller.scrollHeight,scroller.scrollTop+Math.max(300,viewport*.8)));
    await delay(bottom?600:140);scrollEvents++;
    if(scrollEvents%10===0)emit('PAGE_COLLECTION_PROGRESS',{images:found.size});
   }
   verify();gather();
   // Explicit page dropdowns can reveal pages in a sequential JavaScript reader.
   // Chapter/episode and zoom controls are deliberately excluded.
   for(const select of hooks.background?selects:[]){
    if(found.size>=select.options.length)continue;if(userMoved){incomplete=true;break;}
    const original=select.value;
    try{
     for(const option of [...select.options]){
      verify();if(userMoved)break;if(option.value===select.value)continue;
      const before=choose(candidates()).map(v=>v.descriptor.imageUrl).join('\n');
      select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));
      const started=performance.now();let after=before;
      while(!userMoved&&after===before&&performance.now()-started<5000){verify();await delay(100);after=choose(candidates()).map(v=>v.descriptor.imageUrl).join('\n');}
      await delay(250);verify();gather();await hooks.flush?.();
     }
    }finally{
     if(!userMoved&&pageKey()===key&&select.isConnected){select.value=original;select.dispatchEvent(new Event('change',{bubbles:true}));if(!cancelled)await delay(300);}
    }
   }


   const queue=links();
   for(let index=0;index<queue.length;index++){
    verify();const url=queue[index];if(pages.has(url))continue;pages.add(url);
    try{
     const response=await fetch(url,{credentials:'same-origin',signal:AbortSignal.any([collectionAbort.signal,AbortSignal.timeout(15000)])});
     if(!response.ok)throw Error('HTTP '+response.status);
     const doc=new DOMParser().parseFromString(await response.text(),'text/html');verify();gather(doc,url,false);
     for(const next of links(doc,url))if(!pages.has(next)&&!queue.includes(next))queue.push(next);
    }catch(error){if(error.name==='AbortError'&&cancelled)throw error;incomplete=true;emit('PAGE_COLLECTION_WARNING',{message:'Bir bölüm sayfası okunamadı: '+url});}
   }
   await hooks.flush?.();verify();
   const evidence=discovery();return {ok:true,assets:orderedAssets(),pageUrl:key,incomplete,discovery:evidence};
  }catch(error){
   if(error.name==='AbortError'||pageKey()!==key)throw error;
   incomplete=true;emit('PAGE_COLLECTION_WARNING',{message:error.message});
   return {ok:true,assets:orderedAssets(),pageUrl:key,incomplete,discovery:discovery()};
  }finally{
   if(hooks.background&&!userMoved&&pageKey()===key){
    if(scrollRoot!==document.scrollingElement&&scrollRoot.isConnected)moveReader(scrollRoot,initial.left,initial.top);
    window.scrollTo({left:initial.x,top:initial.y,behavior:'instant'});
   }
   for(const type of ['wheel','touchstart','pointerdown','keydown'])window.removeEventListener(type,userInput);
   const evidence=discovery();collecting=false;collectionAbort=undefined;publishViewport();emit('PAGE_COLLECTION_FINISHED',{assets:orderedAssets(),incomplete,discovery:evidence});
  }
 }
 async function read(descriptor){
  if(pageKey()!==descriptor.pageUrl)return {ok:false,reason:'Manga bölümü değişti.'};
  const saved=snapshots.get(descriptor.imageUrl);
  if(saved){const response=await(await sourceCache).match(saved);if(!response)return {ok:false,reason:'Hazırlanan görsel kaynağı bulunamadı; bölümü yeniden hazırla.'};const blob=await globalThis.__mangaReadBoundedBlob(response);return {ok:true,dataUrl:await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);})};}
  if(!isCurrent(descriptor,true))return {ok:false,reason:'Canvas içeriği değişti; yeni sayfayı yeniden tara.'};
  const el=findNode(descriptor);
  // HTTP assets always use original file bytes. Mixing a canvas re-encode with
  // the fetched file would create a false hash mismatch after LRU eviction.
  if(/^https?:/.test(descriptor.imageUrl)){
   const reading=new AbortController();reads.add(reading);
   try{
    const response=await fetch(descriptor.imageUrl,{credentials:'same-origin',cache:'force-cache',signal:AbortSignal.any([reading.signal,AbortSignal.timeout(20000)])});
    if(response.ok){
     const blob=await globalThis.__mangaReadBoundedBlob(response);if(blob.size>80_000_000)throw Error('Görsel dosyası çok büyük.');
     const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
     if(dataUrl.length<=30_000_000)return {ok:true,dataUrl};
    }
   }catch(error){if(reading.signal.aborted||error.name==='AbortError'||error.name==='QuotaExceededError')throw error;}finally{reads.delete(reading);}
   return {ok:false,needsOrigin:true,reason:'Görsel sunucusundan okuma gerekiyor.'};
  }
  const drawable=descriptor.kind==='canvas'?el:descriptor.kind==='image'&&el?.complete&&el.naturalWidth>10&&imageUrl(el)===descriptor.imageUrl?el:null;
  if(drawable){
   const width=drawable.naturalWidth||drawable.width,height=drawable.naturalHeight||drawable.height;
   if(width*height>40_000_000)return {ok:false,reason:'Görselin çözünürlüğü çok büyük.'};
   try{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(drawable,0,0);
    const dataUrl=canvas.toDataURL('image/png');if(dataUrl.length<=30_000_000)return {ok:true,dataUrl};
   }catch{}
  }
  return {ok:false,reason:'Bu görselin görüntüsü okunamadı.'};
 }
 function emit(type,extra={}){
   if(!activeSession)return;
   if(hooks.emit){hooks.emit(type,extra);return;}
   chrome.runtime.sendMessage({type,sessionId:activeSession.id,pageKey:activeSession.pageKey,...extra}).catch(()=>{});
 }
 function publishViewport(){
  if(!activeSession)return;
  if(pageKey()!==activeSession.pageKey){emit('PAGE_CHAPTER_CHANGED');cancel();return;}
  if(!collecting)activeSession.refresh?.();
   const visibleUrls=choose(candidates()).filter(v=>{const r=v.el.getBoundingClientRect();return r.bottom>1&&r.top<scope.innerHeight-1&&r.right>0&&r.left<scope.innerWidth;}).map(v=>activeSession.resolve?.(v.descriptor)??v.descriptor.imageUrl);
   for(const asset of backgroundCandidates()){const el=findNode(asset),r=el?.getBoundingClientRect();if(r&&r.bottom>1&&r.top<scope.innerHeight-1)visibleUrls.push(asset.imageUrl);}
   const visibleFrameUrls=[...document.querySelectorAll('iframe[src]')].filter(el=>{if(excluded(el))return false;const r=el.getBoundingClientRect();return r.bottom>1&&r.top<scope.innerHeight-1&&r.right>0&&r.left<scope.innerWidth;}).map(el=>absolute(el.src));
  emit('PAGE_VIEWPORT_CHANGED',{visibleUrls,visibleFrameUrls});
 }
 function viewportSoon(){
  if(!activeSession||collecting||viewportTimer)return;
  viewportTimer=setTimeout(()=>{viewportTimer=undefined;publishViewport();},150);
 }
 if(!hooks.background){
 window.addEventListener('pagehide',()=>{cancel();void clearSnapshots();});
 window.addEventListener('scroll',viewportSoon,{capture:true,passive:true});window.addEventListener('resize',viewportSoon,{passive:true});
 document.addEventListener('load',event=>{if(event.target.tagName==='IMG')viewportSoon();},true);
 for(const type of ['popstate','hashchange'])window.addEventListener(type,viewportSoon);
 window.navigation?.addEventListener('currententrychange',viewportSoon);
 new MutationObserver(mutations=>{
  if(mutations.some(m=>m.type==='attributes'&&m.target.tagName==='IMG'||m.type==='childList'&&[...m.addedNodes].some(n=>n.nodeType===1&&(n.matches('img,canvas')||n.querySelector('img,canvas')))))viewportSoon();
 }).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','srcset','sizes','data-url','data-src','data-original','data-lazy-src','data-srcset']});
 }
 return {preview,collect,read,findNode,pageKey,cancel,isCurrent,canvasFingerprint};
 }
 const api=createCollector(globalThis);
 globalThis.__mangaPageCollector=api;
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
   if(['PAGE_COLLECT','PAGE_CANCEL_COLLECTION'].includes(message.type)&&globalThis.__mangaJobOwnership&&!globalThis.__mangaJobOwnership.allows(message,sender)){respond({ok:false,reason:'Bu sekmede başka bir çeviri çalışıyor.'});return;}
   if(message.type==='PAGE_CANCEL_COLLECTION'){api.cancel();respond({ok:true});return;}
   const action=message.type==='PAGE_PREVIEW'?()=>api.preview():message.type==='PAGE_COLLECT'?()=>api.collect(message):message.type==='PAGE_READ_ASSET'?()=>api.read(message.asset):null;
  if(!action)return;
  Promise.resolve().then(action).then(respond,e=>respond({ok:false,reason:e.message}));return true;
 });
})();

