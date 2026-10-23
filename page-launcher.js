(() => {
 if(globalThis.__mangaPageLauncher)return;
 globalThis.__mangaPageLauncher=true;
 const own='[data-manga-overlay],[data-manga-reader-helper]';
 const reader='[id*="reader" i],[class*="reader" i],[id*="reading" i],[class*="reading" i],[id*="comic" i],[class*="comic" i],[id*="chapter" i],[class*="chapter" i],#_imageList';
 function excluded(node){return Boolean(node.closest(own+',header,nav,footer,aside,[role="banner"],.advertisement,.ads,.cover,.manga-cover,.comic-cover,.poster,[class*="thumbnail" i],[class*="banner" i]'));}
 function isReader(){
  const candidates=[...document.querySelectorAll('img,canvas')].filter(node=>{
   if(excluded(node))return false;
   const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
   const width=Math.max(node.naturalWidth||node.width||0,rect.width),height=Math.max(node.naturalHeight||node.height||0,rect.height);
   return rect.width>=200&&rect.height>0&&style.visibility!=='hidden'&&width>=250&&height>=300;
  });
  if(candidates.some(node=>node.closest(reader)))return true;
  if(!candidates.length)return false;
  const metadata=[document.title,location.pathname,...[...document.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[name="keywords"]')].map(node=>node.content)].join(' ');
  const manga=/manga|manhwa|manhua|webtoon|comics?/i.test(metadata);
  const chapter=/chapter|episode|bölüm|bolum|(?:^|[\/ _-])(?:ch|c)[-_]?\d/i.test(document.title+' '+location.pathname)||Boolean(document.querySelector('a[rel~="next"],a[rel~="prev"],select[id*="page" i],select[aria-label*="page" i]'));
  return manga&&chapter;
 }
 const topFrame=window===window.top,frames=new Map();
 let host,frame,scheduled=false,lastPresence,route=location.href;
 const instance=crypto.randomUUID();
 const probeFrames=()=>{if(topFrame)void chrome.runtime.sendMessage({type:'MANGA_QUERY_READERS'}).catch(()=>{});};
 function visibleReaderFrame(){
  const embeds=[...document.querySelectorAll('iframe[src]')].filter(node=>!excluded(node)&&node.getBoundingClientRect().width>=250&&node.getBoundingClientRect().height>=300);
  return [...frames.values()].some(info=>info.present&&embeds.some(node=>node.src.split('#')[0]===info.url.split('#')[0]));
 }
 function mount(){
  host=document.createElement('div');host.id='manga-page-launcher';host.setAttribute('data-manga-overlay','launcher');
  host.style.cssText='all:initial!important;position:fixed!important;right:24px!important;top:88px!important;width:64px!important;height:64px!important;z-index:2147483646!important;';
  const shadow=host.attachShadow({mode:'open'});
  frame=document.createElement('iframe');frame.title='Manga Çevirmeni';frame.allow='translator';
  frame.src=chrome.runtime.getURL('panel.html')+'?surface=page&instance='+instance;
  frame.style.cssText='position:absolute;right:0;top:0;width:64px;height:64px;border:0;background:transparent;color-scheme:normal;';
  shadow.append(frame);document.documentElement.append(host);
 }
 function update(){
  const present=isReader();
  if(!topFrame){
   if(lastPresence!==present){lastPresence=present;void chrome.runtime.sendMessage({type:'MANGA_READER_PRESENCE',present}).catch(()=>{});}
   return;
  }
  if(route!==location.href){route=location.href;frames.clear();probeFrames();}
  const show=present||visibleReaderFrame();
  if(show){if(!host)mount();else host.style.setProperty('display','block','important');}
  else if(host){
   if(host.style.display!=='none')void chrome.runtime.sendMessage({type:'MANGA_WIDGET_HIDE',instance}).catch(()=>{});
   host.style.setProperty('display','none','important');
  }
 }
 function updateSoon(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;update();});}
 chrome.runtime.onMessage.addListener((message,sender)=>{
  if(message?.type==='MANGA_READER_PROBE'&&sender.id===chrome.runtime.id&&!sender.tab){lastPresence=undefined;updateSoon();}
  if(message?.type==='MANGA_READER_FRAME'&&topFrame&&sender.id===chrome.runtime.id&&!sender.tab){
   frames.set(message.frameId,{present:message.present,url:message.url});updateSoon();
  }
  if(message?.type==='MANGA_WIDGET_SIZE'&&topFrame&&sender.id===chrome.runtime.id&&sender.url===frame?.src&&message.instance===instance){
   if(!Number.isInteger(message.width)||!Number.isInteger(message.height)||message.width<64||message.width>280||message.height<64||message.height>360)return;
   frame.style.width=message.width+'px';frame.style.height=message.height+'px';
  }
 });
 new MutationObserver(updateSoon).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset','data-src','data-original','class','hidden']});
 document.addEventListener('load',event=>{if(event.target.tagName==='IFRAME')probeFrames();updateSoon();},true);
 window.addEventListener('popstate',updateSoon);window.addEventListener('hashchange',updateSoon);
 window.navigation?.addEventListener('currententrychange',updateSoon);
 update();probeFrames();
})();
