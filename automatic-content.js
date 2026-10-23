(() => {
  if(globalThis.__mangaAutomaticUi) return;
  function createView(initial) {
  let image=initial?globalThis.__mangaPageCollector?.findNode(initial):undefined, descriptor=initial, regions=[], editorVisible=true, focusedId, pickerCleanup, adding=false, host, root, port;
  let boundAsset;
  const identity=()=>descriptor?.kind==='canvas'?descriptor.imageUrl:descriptor?.kind==='background'?descriptor.imageUrl:image?.currentSrc || image?.src || '';
  const pageKey=()=>globalThis.__mangaPageCollector?.pageKey()??location.origin+location.pathname;
  const send=(type,extra={})=>chrome.runtime.sendMessage({type,assetId:descriptor?.assetId,...extra,jobOwner:globalThis.__mangaJobOwnership?.owner}).catch(()=>{});
  function valid(fresh=false) {
    if(descriptor?.pageManaged){
      if(pageKey()!==descriptor.pageUrl||globalThis.__mangaPageCollector?.isCurrent?.(descriptor,fresh)===false)return false;
      const next=globalThis.__mangaPageCollector?.findNode(descriptor);
      if(next!==image){image=next;globalThis.__mangaOverlayManager?.invalidate(descriptor.assetId);}
      return true;
    }
    return Boolean(image?.isConnected && descriptor && identity()===descriptor.imageUrl &&
      pageKey()===descriptor.pageUrl && image.naturalWidth===descriptor.width && image.naturalHeight===descriptor.height);
  }
  function placement() {
    if(!valid() || !image?.isConnected) return null;
    const r=image.getBoundingClientRect(),css=getComputedStyle(image);
    const bw=parseFloat(css.borderLeftWidth)||0,bh=parseFloat(css.borderTopWidth)||0;
    const pl=parseFloat(css.paddingLeft)||0,pt=parseFloat(css.paddingTop)||0;
    const sx=r.width/(image.offsetWidth||r.width),sy=r.height/(image.offsetHeight||r.height);
    const w=(image.clientWidth-pl-(parseFloat(css.paddingRight)||0))*sx;
    const h=(image.clientHeight-pt-(parseFloat(css.paddingBottom)||0))*sy;
    const left=r.left+(bw+pl)*sx,top=r.top+(bh+pt)*sy;
    if(w<=0 || h<=0) return null;
    let dw=w,dh=h;
    const fit=descriptor.kind==='background'?(css.backgroundSize==='cover'?'cover':css.backgroundSize==='contain'?'contain':'none'):css.objectFit,nw=descriptor.width,nh=descriptor.height;
    if(fit!=='fill') {
      const scale=fit==='cover'?Math.max(w/nw,h/nh):fit==='none'?1:fit==='scale-down'?Math.min(1,w/nw,h/nh):Math.min(w/nw,h/nh);
      dw=nw*scale;dh=nh*scale;
    }
    const position=(descriptor.kind==='background'?css.backgroundPosition:css.objectPosition).split(/\s+/);
    function offset(value,space,scale) {
      if(value==='left'||value==='top') return 0;
      if(value==='right'||value==='bottom') return space;
      if(value==='center'||!value) return space*.5;
      return value.endsWith('%')?space*parseFloat(value)/100:(parseFloat(value)||0)*scale;
    }
    return {left:left+offset(position[0],w-dw,sx),top:top+offset(position[1],h-dh,sy),
      width:dw,height:dh,clip:{left,top,right:left+w,bottom:top+h}};
  }
  function screenBounds(b) {
    const p=placement(); if(!p) return null;
    return {left:p.left+b.x/descriptor.width*p.width,top:p.top+b.y/descriptor.height*p.height,
      width:b.width/descriptor.width*p.width,height:b.height/descriptor.height*p.height};
  }
  function visibleBounds(b) {
    const rect=screenBounds(b),clip=placement()?.clip;
    if(!rect || !clip)return null;
    const left=Math.max(rect.left,clip.left),top=Math.max(rect.top,clip.top);
    const right=Math.min(rect.left+rect.width,clip.right),bottom=Math.min(rect.top+rect.height,clip.bottom);
    return right>left && bottom>top?{left,top,width:right-left,height:bottom-top,rect}:null;
  }
  function nativePoint(x,y) {
    const p=placement();if(!p)throw new Error('Görsel şu anda okuyucuda görünmüyor.');
    return {x:Math.max(0,Math.min(descriptor.width,(x-p.left)/p.width*descriptor.width)),
      y:Math.max(0,Math.min(descriptor.height,(y-p.top)/p.height*descriptor.height))};
  }
  function boundsBetween(a,b) { return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)}; }
  function clearCallout(id) { globalThis.__mangaOverlayManager?.hide(id); }
  function hideTranslation(id) { clearCallout(id);globalThis.__mangaAutomaticBridge?.hide(id); }
  function ensureHost() {
    if(host?.isConnected) return;
    host=document.createElement('div');host.setAttribute('data-manga-overlay','editor');host.style.cssText='position:fixed;inset:0;z-index:2147483645;pointer-events:none;';
    root=host.attachShadow({mode:'closed'});
    const style=document.createElement('style');
    style.textContent='*{box-sizing:border-box;font-family:Arial,sans-serif}.box{position:fixed;border:2px solid #2563eb;pointer-events:auto;touch-action:none;background:transparent;cursor:move}.box.off{border-color:#b7791f;border-style:dashed}.box.focus{box-shadow:0 0 0 2px #fff}.tag{position:absolute;left:-2px;top:-24px;background:#2563eb;color:white;font-size:12px;white-space:nowrap;display:flex;gap:3px;padding:2px;border-radius:3px}.off .tag{background:#8c5d19}.tag button{border:0;background:transparent;color:white;padding:0 3px;cursor:pointer;font-weight:bold}.handle{position:absolute;width:10px;height:10px;border:1px solid white;background:#2563eb}.callout{position:fixed;max-width:240px;padding:7px 9px;background:#fffbe7;color:#171717;border:1px solid #ae8215;border-radius:5px;font-size:14px;line-height:1.25;box-shadow:0 2px 6px #0003;pointer-events:auto;overflow-wrap:anywhere;max-height:min(240px,40vh);overflow:auto;overscroll-behavior:contain}.draw{position:fixed;border:2px dashed #dc2626;background:#dc26261c;pointer-events:none}';
    root.append(style);document.documentElement.append(host);
  }
  function bindLayout() {
    if(!descriptor)return;
    const manager=globalThis.__mangaOverlayManager;
    if(boundAsset!==descriptor.assetId){
      if(boundAsset)manager?.removeAsset(boundAsset);
      boundAsset=descriptor.assetId;
      manager?.register(boundAsset,()=>{
        if(!descriptor||!valid()){if(descriptor)invalidate();return null;}
        return {image,descriptor,regions,placement:placement()};
      },update,state=>send('AUTO_DISPLAY_STATE',state),edit=>{
        const r=regions.find(r=>r.id===edit.regionId);if(r)r.editRevision=edit.editRevision;
        send('AUTO_TEXT_EDITED',edit);
      });
    }
    manager?.editor(boundAsset,editorVisible);
  }
  function registerRegion(r) {
    globalThis.__mangaAutomaticBridge?.register(r.id,()=>{
      const visible=valid()&&visibleBounds(r.bounds);
      if(!visible)return null;
      const rect=visible.rect;
      return Math.abs(visible.width-rect.width)<.5 && Math.abs(visible.height-rect.height)<.5?rect:null;
    });
  }
  function update() {
    if(descriptor && !valid()) { invalidate();return; }
    if(!root) return;

    for(const element of root.querySelectorAll('.box')) {
      const r=regions.find(b=>b.id===element.dataset.regionId),visible=r&&visibleBounds(r.bounds),rect=visible?.rect;
      element.hidden=!editorVisible || !rect;
      if(rect) Object.assign(element.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',
        clipPath:visible.width<rect.width-.5 || visible.height<rect.height-.5?
          'inset('+Math.max(0,visible.top-rect.top)+'px '+Math.max(0,rect.left+rect.width-visible.left-visible.width)+'px '+Math.max(0,rect.top+rect.height-visible.top-visible.height)+'px '+Math.max(0,visible.left-rect.left)+'px)':'none'});
    }

  }
  function schedule(){if(boundAsset)globalThis.__mangaOverlayManager?.invalidate(boundAsset);}
  function changed(r,geometry=true) {
    if(geometry){r.revision=(r.revision||0)+1;r.manual=true;delete r.displayGeometry;}hideTranslation(r.id);registerRegion(r);
    send('AUTO_REGIONS_CHANGED',{selectionOnly:!geometry,regions:regions.map(({id,number,bounds,kind,score,uncertain,selected,revision,bubbleBounds,manual,displayGeometry,displayOverride,automaticOverride})=>({id,number,bounds,kind,score,uncertain,selected,revision,bubbleBounds,manual,displayGeometry,displayOverride,automaticOverride}))});
    render();
  }
  function drag(event,r,corner='move') {
    if(event.button!==0 || !valid()) return;
    event.preventDefault();event.stopPropagation();
    const element=event.currentTarget,start=nativePoint(event.clientX,event.clientY),original={...r.bounds};
    element.setPointerCapture(event.pointerId);
    const move=(e)=>{
      if(!valid()){cancel();return;}
      const point=nativePoint(e.clientX,e.clientY),dx=point.x-start.x,dy=point.y-start.y;
      if(corner==='move') {
        r.bounds={...original,x:Math.max(0,Math.min(descriptor.width-original.width,original.x+dx)),
          y:Math.max(0,Math.min(descriptor.height-original.height,original.y+dy))};
      } else {
        const opposite={x:corner.includes('w')?original.x+original.width:original.x,y:corner.includes('n')?original.y+original.height:original.y};
        r.bounds=boundsBetween(opposite,point);
      }
      update();
    };
    const finish=()=>{
      element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',finish);element.removeEventListener('pointercancel',cancel);
      if(r.bounds.width<8||r.bounds.height<8) r.bounds=original;
      changed(r);
    };
    const cancel=()=>{
      r.bounds=original;element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',finish);element.removeEventListener('pointercancel',cancel);update();
    };
    element.addEventListener('pointermove',move);element.addEventListener('pointerup',finish);element.addEventListener('pointercancel',cancel);
  }
  function render() {
    ensureHost();bindLayout();
    for(const old of root.querySelectorAll('.box')) old.remove();
    for(const r of editorVisible?regions:[]) {
      registerRegion(r);
      const box=document.createElement('div');box.className='box'+(!r.selected?' off':'')+(focusedId===r.id?' focus':'');
      box.dataset.regionId=r.id;
      const tag=document.createElement('div');tag.className='tag';
      const check=document.createElement('input');check.type='checkbox';check.checked=r.selected;check.setAttribute('aria-label',r.number+'. alanı seç');
      check.addEventListener('pointerdown',e=>e.stopPropagation());
      check.addEventListener('change',()=>{r.selected=check.checked;r.automaticOverride=check.checked;changed(r,false);});
      const focus=document.createElement('button');focus.textContent=String(r.number)+(r.uncertain?' ?':'');focus.title='Bu alanın metnini düzenle';
      focus.addEventListener('pointerdown',e=>e.stopPropagation());
      focus.addEventListener('click',()=>{focusedId=r.id;render();send('AUTO_FOCUS_REGION',{regionId:r.id});});
      const remove=document.createElement('button');remove.textContent='×';remove.title='Yanlış alanı sil';
      remove.addEventListener('pointerdown',e=>e.stopPropagation());
      remove.addEventListener('click',()=>{hideTranslation(r.id);regions=regions.filter(x=>x!==r);changed(r);});
      tag.append(check,focus,remove);box.append(tag);
      box.addEventListener('pointerdown',e=>drag(e,r));
      box.addEventListener('dblclick',()=>{focusedId=r.id;send('AUTO_FOCUS_REGION',{regionId:r.id});render();});
      if(focusedId===r.id) for(const corner of ['nw','ne','sw','se']) {
        const handle=document.createElement('div');handle.className='handle';
        handle.style.cssText=(corner.includes('n')?'top:-5px;':'bottom:-5px;')+(corner.includes('w')?'left:-5px;':'right:-5px;')+'cursor:'+corner+'-resize;';
        handle.addEventListener('pointerdown',e=>drag(e,r,corner));box.append(handle);
      }
      root.append(box);
    }
    schedule();update();
  }
  function invalidate() {
    cancelPicking();if(boundAsset)globalThis.__mangaOverlayManager?.removeAsset(boundAsset);boundAsset=undefined;
    for(const r of regions) {hideTranslation(r.id);globalThis.__mangaAutomaticBridge?.remove(r.id);}
    const assetId=descriptor?.assetId,reason=descriptor?.pageManaged?'Manga bölümü değişti. Yeni bölüm için Sayfayı çevir düğmesine bas.':'Manga görseli değişti. Görseli yeniden seç.';
    regions=[];descriptor=undefined;image=undefined;root?.querySelectorAll('.box').forEach(e=>e.remove());
    send('AUTO_INVALIDATED',{assetId,reason});
  }
  function cancelPicking() { pickerCleanup?.();pickerCleanup=undefined;adding=false; }
  function pickImage() {
    cancelPicking();editorVisible=false;render();
    const outline=document.createElement('div');outline.style.cssText='position:fixed;pointer-events:none;border:3px solid #2563eb;z-index:2147483647;';
    const hint=document.createElement('div');hint.textContent='Taranacak manga görseline tıkla · Esc: iptal';
    hint.style.cssText='position:fixed;top:12px;left:12px;z-index:2147483647;background:#171717;color:white;padding:9px;font:14px Arial;pointer-events:none;';
    document.documentElement.append(outline,hint);
    const move=e=>{
      const target=document.elementFromPoint(e.clientX,e.clientY)?.closest?.('img');
      const r=target?.getBoundingClientRect();outline.hidden=!r;
      if(r)Object.assign(outline.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
    };
    const click=e=>{
      if(!e.isTrusted)return;
      const target=e.target.closest?.('img');
      if(!target)return;
      e.preventDefault();e.stopImmediatePropagation();
      if(!target.complete||target.naturalWidth<32||target.naturalHeight<32) {send('AUTO_PICK_CANCELLED',{reason:'Görsel henüz yüklenmedi. Yüklendikten sonra yeniden seç.'});cancelPicking();return;}
      for(const r of regions){hideTranslation(r.id);globalThis.__mangaAutomaticBridge?.remove(r.id);}
      if(boundAsset)globalThis.__mangaOverlayManager?.removeAsset(boundAsset);boundAsset=undefined;
      image=target;descriptor={assetId:crypto.randomUUID(),imageUrl:identity(),width:image.naturalWidth,height:image.naturalHeight,pageUrl:pageKey()};
      descriptor.pageKey=/^(data|blob):/.test(descriptor.imageUrl)?descriptor.pageUrl:descriptor.pageUrl+'::'+descriptor.imageUrl;
      regions=[];focusedId=undefined;editorVisible=true;
      image.addEventListener('load',schedule,{once:true});
      cancelPicking();render();send('AUTO_IMAGE_SELECTED',{image:descriptor});
    };
    const key=e=>{if(e.key==='Escape'){cancelPicking();send('AUTO_PICK_CANCELLED',{reason:'Görsel seçimi iptal edildi.'});}};
    document.addEventListener('pointermove',move,true);document.addEventListener('click',click,true);window.addEventListener('keydown',key,true);
    pickerCleanup=()=>{outline.remove();hint.remove();document.removeEventListener('pointermove',move,true);document.removeEventListener('click',click,true);window.removeEventListener('keydown',key,true);};
  }
  function startAdd() {
    cancelPicking();if(!valid())throw new Error('Görseli yeniden seç.');
    adding=true;editorVisible=false;render();
    const layer=document.createElement('div');layer.style.cssText='position:fixed;inset:0;z-index:2147483647;cursor:crosshair;touch-action:none;pointer-events:auto;';
    const preview=document.createElement('div');preview.className='draw';root.append(layer,preview);
    let start;
    layer.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();layer.setPointerCapture(e.pointerId);start=nativePoint(e.clientX,e.clientY);});
    layer.addEventListener('pointermove',e=>{
      if(!start)return;const r=screenBounds(boundsBetween(start,nativePoint(e.clientX,e.clientY)));
      Object.assign(preview.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
    });
    layer.addEventListener('pointerup',e=>{
      if(!start)return;const bounds=boundsBetween(start,nativePoint(e.clientX,e.clientY));cancelPicking();editorVisible=true;
      if(bounds.width<8||bounds.height<8){render();return;}
      const number=Math.max(0,...regions.map(r=>r.number))+1;
      const r={id:crypto.randomUUID(),number,bounds,kind:'text',score:1,manual:true,selected:true,uncertain:false,revision:0};
      regions.push(r);focusedId=r.id;changed(r);send('AUTO_FOCUS_REGION',{regionId:r.id});
    });
    const key=e=>{if(e.key==='Escape'){cancelPicking();editorVisible=true;render();}};
    window.addEventListener('keydown',key,true);
    pickerCleanup=()=>{layer.remove();preview.remove();window.removeEventListener('keydown',key,true);};
    layer.addEventListener('pointercancel',()=>{cancelPicking();editorVisible=true;render();});
  }
  async function readImage() {
    if(!valid())throw new Error('Manga görseli değişti.');
    if(descriptor.pageManaged)return globalThis.__mangaPageCollector.read(descriptor);
    if(descriptor.width*descriptor.height>40_000_000)throw new Error('Bu görsel çok büyük. Daha küçük bir sayfa görseli seç.');
    const canvas=document.createElement('canvas');canvas.width=descriptor.width;canvas.height=descriptor.height;
    canvas.getContext('2d').drawImage(image,0,0);
    try {const dataUrl=canvas.toDataURL('image/png');if(dataUrl.length>30_000_000)return {ok:false,reason:'Bu görsel aktarılacak kadar küçük değil. Elle balon seçimini kullanabilirsin.'};return {ok:true,dataUrl};}
    catch {return {ok:false,needsOrigin:true,reason:'Tam görseli okumak için görsel sunucusuna erişim gerekiyor.'};}
  }
  async function showAutomatic(message) {
    if(!valid(true) || message.assetId!==descriptor.assetId) return {ok:false,reason:'Manga görseli değişti. Yeniden seç.'};
    const r=regions.find(b=>b.id===message.selectionId);
    if(!r || !message.text?.trim())return {ok:false,reason:'Alan veya çeviri bulunamadı.'};
    if(message.revision!==undefined&&message.revision!==(r.revision||0))return {ok:false,reason:'Alan değişti.'};
    if(!globalThis.__mangaOverlayManager?.acceptsSession(message.layoutSession))return {ok:false,reason:'İşlem durduruldu; geç çeviri uygulanmadı.'};
    bindLayout();registerRegion(r);
    const manager=globalThis.__mangaOverlayManager;
    if(!manager)return {ok:false,reason:'Yerleştirme motoru hazırlanamadı.'};
    const result=manager.show(descriptor.assetId,r,message);
    if(!result.ok)return result;
    return manager.whenRendered?manager.whenRendered(r.id):result;
  }
  async function handle(message) {
      if(message.type==='AUTO_PICK_IMAGE'){pickImage();return {ok:true};}
      if(message.type==='AUTO_CANCEL_PICK'){cancelPicking();return {ok:true};}
      if(message.assetId!==descriptor?.assetId || !valid(message.type==='AUTO_CHECK_IMAGE'))return {ok:false,reason:'Manga görseli değişti. Yeniden seç.'};
      if(message.type==='AUTO_READ_IMAGE')return readImage();
      if(message.type==='AUTO_CHECK_IMAGE')return {ok:true};
      if(message.type==='AUTO_SET_REGIONS') {
        if(!Array.isArray(message.regions)||message.regions.length>1000)throw new Error('Geçersiz alan listesi.');
        for(const r of regions) if(!message.regions.some(b=>b.id===r.id)){hideTranslation(r.id);globalThis.__mangaAutomaticBridge?.remove(r.id);}
        regions=message.regions;editorVisible=message.visible??true;render();return {ok:true};
      }
      if(message.type==='AUTO_FOCUS'){focusedId=message.regionId;editorVisible=true;render();return {ok:true};}
      if(message.type==='AUTO_ADD'){startAdd();return {ok:true};}
      if(message.type==='AUTO_EDITOR'){editorVisible=message.visible;render();return {ok:true};}
      if(message.type==='AUTO_PAGE_NUMBER'){descriptor.displayIndex=message.imageNumber;globalThis.__mangaOverlayManager?.updateNumber(descriptor.assetId,message.imageNumber);return {ok:true};}
      if(message.type==='AUTO_EDIT_REVISION'){
        const r=regions.find(r=>r.id===message.selectionId);
        if(!r||!Number.isInteger(message.editRevision)||message.editRevision<(r.editRevision||0))return {ok:false,reason:'Eski metin düzenlemesi.'};
        r.editRevision=message.editRevision;return {ok:true};
      }
      if(message.type==='AUTO_SHOW_TRANSLATION')return showAutomatic(message);
      if(message.type==='AUTO_EXPORT_REGIONS')return {ok:true,regions:globalThis.__mangaOverlayManager?.snapshot(descriptor.assetId)??[]};
      if(message.type==='AUTO_HIDE_ALL'){for(const r of regions)hideTranslation(r.id);return {ok:true};}
      if(message.type==='AUTO_GET_STATE')return {ok:true,regions,placement:placement(),visible:regions.map(r=>({id:r.id,bounds:visibleBounds(r.bounds)})),callouts:globalThis.__mangaOverlayManager?.labels(descriptor.assetId)??0,overlays:globalThis.__mangaAutomaticBridge?.rects().filter(o=>regions.some(r=>r.id===o.id))??[]};
      return {ok:false,reason:'Bilinmeyen işlem.'};
  }
  return {handle,pauseEditor(){cancelPicking();editorVisible=false;render();},hide:clearCallout,
    get id(){return descriptor?.assetId;},
    dispose(){
      cancelPicking();if(boundAsset)globalThis.__mangaOverlayManager?.removeAsset(boundAsset);boundAsset=undefined;
      for(const r of regions){hideTranslation(r.id);globalThis.__mangaAutomaticBridge?.remove(r.id);}
      host?.remove();descriptor=undefined;image=undefined;

    }};
  }
  const views=new Map();let legacy=createView(),port;
  views.set('legacy',legacy);
  function clearPage(){for(const [key,view]of views)if(key!=='legacy'){view.dispose();views.delete(key);}}
  globalThis.__mangaAutomaticUi={
    hide(id){for(const view of views.values())view.hide(id);},
    pauseEditor(){for(const view of views.values())view.pauseEditor();},
  };
  chrome.runtime.onConnect.addListener(connection=>{
    if(connection.name!=='automatic-session'&&!connection.name.startsWith('automatic-session:'))return;
    const owner=connection.name.slice('automatic-session:'.length),gate=globalThis.__mangaJobOwnership;
    if(gate&&!gate.allows({jobOwner:owner},connection.sender)){connection.disconnect();return;}
    port?.disconnect();port=connection;
    // A reopened panel owns fresh asset IDs; retire layers left by its previous connection.
    clearPage();legacy.dispose();legacy=createView();views.set('legacy',legacy);
    connection.onDisconnect.addListener(()=>{if(port!==connection)return;gate?.releaseController(owner,connection.sender);port=undefined;globalThis.__mangaAutomaticUi.pauseEditor();});
  });
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(!message?.type?.startsWith('AUTO_'))return;
    (async()=>{
      const gate=globalThis.__mangaJobOwnership;
      if(message.type==='AUTO_CLAIM_JOB')return sender.id===chrome.runtime.id?gate?.claim(message.owner,sender)??{ok:false,reason:'Oturum aracı hazır değil.'}:{ok:false};
      if(message.type==='AUTO_RELEASE_JOB')return gate?.release(message.owner,sender)??{ok:true};
      if(!['AUTO_LAYOUT_STATE','AUTO_PAGE_STATE','AUTO_EXPORT_REGIONS','AUTO_CHECK_IMAGE'].includes(message.type)&&gate&&!gate.allows(message,sender))throw Error('Bu sekmede başka bir çeviri çalışıyor. Önce onu durdur.');
      if(message.type==='AUTO_LAYOUT_STATE')return {ok:true,...globalThis.__mangaOverlayManager?.state()};
      if(message.type==='AUTO_LAYOUT_SESSION')return globalThis.__mangaOverlayManager.beginSession(message.layoutSession);
      if(message.type==='AUTO_CANCEL_LAYOUT_SESSION')return globalThis.__mangaOverlayManager.cancelSession(message.layoutSession);
      if(message.type==='AUTO_PAGE_CLEAR'){clearPage();legacy.dispose();legacy=createView();views.set('legacy',legacy);return {ok:true};}
      if(message.type==='AUTO_PAGE_REGISTER'){
        const asset=message.asset;if(!asset?.assetId||!asset.pageManaged)throw Error('Geçersiz görsel.');
        views.get(asset.assetId)?.dispose();views.set(asset.assetId,createView(asset));return {ok:true};
      }
      if(message.type==='AUTO_PAGE_STATE'){
        const assets=[];
        for(const [key,view]of views)if(key!=='legacy')assets.push({assetId:key,...await view.handle({type:'AUTO_GET_STATE',assetId:key})});
        return {ok:true,assets};
      }
      if(message.type==='AUTO_PAGE_HIDE_ALL' || message.type==='AUTO_PAGE_EDITOR'){
        if(message.type==='AUTO_PAGE_HIDE_ALL')globalThis.__mangaAutomaticBridge?.hideAll();
        for(const view of views.values())if(view.id)await view.handle({type:message.type==='AUTO_PAGE_HIDE_ALL'?'AUTO_HIDE_ALL':'AUTO_EDITOR',assetId:view.id,visible:message.visible});
        return {ok:true};
      }
      if(message.type==='AUTO_PICK_IMAGE'||message.type==='AUTO_CANCEL_PICK')return legacy.handle(message);
      const view=views.get(message.assetId)||[...views.values()].find(v=>v.id===message.assetId);
      if(!view)return {ok:false,reason:'Manga görseli değişti. Yeniden tara.'};
      return view.handle(message);
    })().then(respond,error=>respond({ok:false,reason:error.message}));return true;
  });
})();
