(() => {
  if (globalThis.__mangaTranslatorContent) return;
  globalThis.__mangaTranslatorContent = true;

  const selections = new Map();
  const shown = new Map();
  let selectorHost;

  const translationHost = document.createElement('div');
  translationHost.setAttribute('data-manga-overlay','manual');
  translationHost.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  const translationRoot = translationHost.attachShadow({ mode: 'closed' });
  document.documentElement.append(translationHost);

  function removeSelector() {
    selectorHost?.remove();
    selectorHost = null;
  }

  function selectionCancelled(reason) {
    chrome.runtime.sendMessage({ type: 'SELECTION_CANCELLED', reason }).catch(() => {});
  }

  function regionRect(selection) {
    if (selection.rectProvider) return selection.rectProvider();
    if (selection.anchor?.isConnected) {
      const image = selection.anchor.getBoundingClientRect();
      const r = selection.relative;
      return {
        left: image.left + image.width * r.left,
        top: image.top + image.height * r.top,
        width: image.width * r.width,
        height: image.height * r.height,
      };
    }
    if (selection.anchor) return null;
    const r = selection.pageRect;
    return {
      left: r.left - window.scrollX,
      top: r.top - window.scrollY,
      width: r.width,
      height: r.height,
    };
  }

  function fitText(overlay, textElement) {
    if(textElement?.tagName==='IMG')return true;
    for (let size = Math.round(22*Number(textElement.dataset.fontScale||1)); size >= 9; size--) {
      textElement.style.fontSize = `${size}px`;
      if (textElement.scrollHeight <= overlay.clientHeight - 4 &&
          textElement.scrollWidth <= overlay.clientWidth - 4) return true;
    }
    return false;
  }

  function positionShown() {
    for (const [id, item] of shown) {
      const selection = selections.get(id);
      const rect = selection && regionRect(selection);
      if (!rect || rect.width < 10 || rect.height < 8) {
        if(selection?.rectProvider){item.overlay.hidden=true;continue;}
        item.overlay.remove();
        shown.delete(id);
        chrome.runtime.sendMessage({ type: 'OVERLAY_LOST', selectionId: id }).catch(() => {});
        continue;
      }
      item.overlay.hidden=false;
      Object.assign(item.overlay.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      if (!fitText(item.overlay, item.textElement)) {
        item.overlay.remove();
        shown.delete(id);
        chrome.runtime.sendMessage({ type: 'OVERLAY_LOST', selectionId: id }).catch(() => {});
      }
    }
  }

  let updateQueued = false;
  function schedulePositionUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    requestAnimationFrame(() => {
      updateQueued = false;
      positionShown();
    });
  }
  window.addEventListener('scroll', schedulePositionUpdate, true);
  window.addEventListener('resize', schedulePositionUpdate);
  window.visualViewport?.addEventListener('scroll', schedulePositionUpdate);
  window.visualViewport?.addEventListener('resize', schedulePositionUpdate);
  const imageResizeObserver = new ResizeObserver(schedulePositionUpdate);

  function startSelection() {
    removeSelector();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const surface = document.createElement('div');
    surface.style.cssText = 'position:fixed;inset:0;cursor:crosshair;touch-action:none;background:rgba(0,0,0,.08);';
    const rectangle = document.createElement('div');
    rectangle.style.cssText = 'position:fixed;display:none;box-sizing:border-box;border:2px solid #3b82f6;background:rgba(59,130,246,.18);pointer-events:none;';
    const hint = document.createElement('div');
    hint.textContent = 'Balondaki yazı alanını seç · Çıkmak için Esc';
    hint.style.cssText = 'position:fixed;left:12px;top:12px;padding:8px 11px;background:#171717;color:#fff;font:14px Arial,sans-serif;border-radius:6px;pointer-events:none;';
    shadow.append(surface, rectangle, hint);
    document.documentElement.append(host);
    host.setAttribute('data-manga-overlay','selector');
    selectorHost = host;

    let start;
    function currentRect(event) {
      const left = Math.max(0, Math.min(start.x, event.clientX));
      const top = Math.max(0, Math.min(start.y, event.clientY));
      const right = Math.min(window.innerWidth, Math.max(start.x, event.clientX));
      const bottom = Math.min(window.innerHeight, Math.max(start.y, event.clientY));
      return { left, top, width: right - left, height: bottom - top };
    }
    function draw(rect) {
      Object.assign(rectangle.style, {
        display: 'block', left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`,
      });
    }
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      window.removeEventListener('keydown', onKey, true);
      removeSelector();
      selectionCancelled('Seçim iptal edildi.');
    };
    window.addEventListener('keydown', onKey, true);

    surface.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      surface.setPointerCapture(event.pointerId);
      start = { x: event.clientX, y: event.clientY };
      draw(currentRect(event));
    });
    surface.addEventListener('pointermove', (event) => {
      if (start) draw(currentRect(event));
    });
    surface.addEventListener('pointerup', (event) => {
      if (!start) return;
      event.preventDefault();
      const rect = currentRect(event);
      start = null;
      window.removeEventListener('keydown', onKey, true);
      removeSelector();
      if (rect.width < 12 || rect.height < 8) {
        selectionCancelled('Seçim çok küçük. Yazı alanını yeniden seç.');
        return;
      }

      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const underlying = document.elementFromPoint(centerX, centerY);
      const image = underlying?.closest?.('img') ?? null;
      const imageRect = image?.getBoundingClientRect();
      const isImageAnchor = imageRect && imageRect.width > 0 && imageRect.height > 0 &&
        rect.left >= imageRect.left && rect.top >= imageRect.top &&
        rect.left + rect.width <= imageRect.right && rect.top + rect.height <= imageRect.bottom;
      if (isImageAnchor) imageResizeObserver.observe(image);
      const selectionId = crypto.randomUUID();
      selections.set(selectionId, {
        anchor: isImageAnchor ? image : null,
        relative: isImageAnchor ? {
          left: (rect.left - imageRect.left) / imageRect.width,
          top: (rect.top - imageRect.top) / imageRect.height,
          width: rect.width / imageRect.width,
          height: rect.height / imageRect.height,
        } : null,
        pageRect: {
          left: rect.left + window.scrollX,
          top: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
        },
      });
      const imageUrl = isImageAnchor ? image.currentSrc || image.src : '';
      const pageUrl = `${location.origin}${location.pathname}`;
      const message = {
        type: 'SELECTION_COMPLETE', selectionId, rect,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        pageKey: imageUrl && !/^(data|blob):/i.test(imageUrl)
          ? `${pageUrl}::${imageUrl}` : pageUrl,
      };
      requestAnimationFrame(() => requestAnimationFrame(() => {
        chrome.runtime.sendMessage(message).catch(() => {});
      }));
    });
    surface.addEventListener('pointercancel', () => {
      start = null;
      window.removeEventListener('keydown', onKey, true);
      removeSelector();
      selectionCancelled('Seçim iptal edildi.');
    });
  }

  function showTranslation({ selectionId, text, background, textColor, textStyle, direction, eraseBoxes, imageWidth, imageHeight, renderedImageDataUrl }) {
    const selection = selections.get(selectionId);
    if (!selection) return { ok: false, reason: 'Seçim artık sayfada yok. Yeniden seç.' };
    if (!text?.trim()) return { ok: false, reason: 'Türkçe metin boş.' };
    const rect = regionRect(selection);
    if (!rect) return { ok: false, reason: 'Manga görseli değişti. Yeniden seç.' };
    shown.get(selectionId)?.overlay.remove();
    shown.delete(selectionId);
    if(renderedImageDataUrl){
      if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(renderedImageDataUrl)||renderedImageDataUrl.length>24000000)return {ok:false,reason:'Çeviri görseli geçersiz.'};
      const overlay=document.createElement('div'),image=document.createElement('img');
      overlay.style.cssText='position:fixed;pointer-events:none;overflow:hidden;';Object.assign(overlay.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
      image.src=renderedImageDataUrl;image.alt=text;image.style.cssText='display:block;width:100%;height:100%;';overlay.append(image);translationRoot.append(overlay);shown.set(selectionId,{overlay,textElement:image});return {ok:true};
    }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;box-sizing:border-box;padding:2px;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;';
    const validBoxes = Array.isArray(eraseBoxes) && imageWidth > 0 && imageHeight > 0
      ? eraseBoxes.filter((box) => box && Number.isFinite(box.x0) && Number.isFinite(box.y0) &&
          Number.isFinite(box.x1) && Number.isFinite(box.y1) && box.x1 > box.x0 && box.y1 > box.y0)
      : [];
    overlay.style.backgroundColor = validBoxes.length ? 'transparent' : background;
    const layout=globalThis.__mangaTextLayout,style=layout?.normalizeTextStyle(textStyle)??{color:null,align:'center',scale:1};
    overlay.style.color = style.color??(textColor === '#fff' ? '#fff' : '#171717');
    for (const box of validBoxes) {
      const cover = document.createElement('div');
      cover.style.cssText = 'position:absolute;pointer-events:none;';
      Object.assign(cover.style, {
        left: `calc(${box.x0 / imageWidth * 100}% - 2px)`,
        top: `calc(${box.y0 / imageHeight * 100}% - 2px)`,
        width: `calc(${(box.x1 - box.x0) / imageWidth * 100}% + 4px)`,
        height: `calc(${(box.y1 - box.y0) / imageHeight * 100}% + 4px)`,
        backgroundColor: background,
      });
      overlay.append(cover);
    }
    const textElement = document.createElement('div');
    textElement.textContent = text.trim();
    textElement.dir = direction === 'rtl' ? 'rtl' : 'ltr';
    textElement.style.cssText = 'box-sizing:border-box;width:100%;flex:none;text-align:center;white-space:pre-wrap;overflow-wrap:normal;word-break:normal;hyphens:none;font-family:Arial,sans-serif;font-weight:600;line-height:1.05;';
    textElement.style.position = 'relative';
    textElement.style.textAlign=style.align;textElement.dataset.fontScale=String(style.scale);
    if(layout)textElement.style.fontFamily=layout.fontCss(style,1).replace(/^600 1px /,'');
    overlay.append(textElement);
    translationRoot.append(overlay);
    Object.assign(overlay.style, {
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
    if (!fitText(overlay, textElement)) {
      overlay.remove();
      return { ok: false, reason: 'Türkçe metin bu alana sığmadı. Daha geniş bir yazı alanı seç.' };
    }
    shown.set(selectionId, { overlay, textElement });
    return { ok: true };
  }

  globalThis.__mangaAutomaticBridge = {
    register(id,rectProvider) { selections.set(id,{rectProvider}); },
    show: showTranslation,
    refresh: schedulePositionUpdate,
    rects() { return [...shown].map(([id,item])=>{const b=item.overlay.getBoundingClientRect();return {id,left:b.left,top:b.top,width:b.width,height:b.height};}).concat(globalThis.__mangaOverlayManager?.rects()??[]); },
    hide(id) { shown.get(id)?.overlay.remove();shown.delete(id);globalThis.__mangaOverlayManager?.hide(id); },
    hideAll() { for(const item of shown.values())item.overlay.remove();shown.clear();globalThis.__mangaOverlayManager?.hideAll(); },
    remove(id) { shown.get(id)?.overlay.remove();shown.delete(id);selections.delete(id);globalThis.__mangaOverlayManager?.hide(id); },
  };
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'START_SELECTION') {
      globalThis.__mangaAutomaticUi?.pauseEditor();
      startSelection();
      sendResponse({ ok: true });
    } else if (message?.type === 'SHOW_TRANSLATION') {
      sendResponse(showTranslation(message));
    } else if (message?.type === 'HIDE_TRANSLATION') {
      globalThis.__mangaAutomaticUi?.hide(message.selectionId);
      shown.get(message.selectionId)?.overlay.remove();
      shown.delete(message.selectionId);
      sendResponse({ ok: true });
    }
  });
})();
