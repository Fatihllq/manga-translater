import {renderPage} from './page-renderer.js';
import {prepareRegion} from './inpaint-client.js';
import { cropScreenshot } from './crop.js';
import { initAutomatic } from './automatic-panel.js';
import { recognize } from './ocr.js';
import { translate, checkTranslationAvailability, hasTranslator,releaseTranslators } from './translation.js';
import { DEFAULT_LANGUAGE_PAIR, getTargetLanguage } from './languages.js';
import { allLabels, countLabels, deleteLabel, importLabels, saveLabel } from './db.js';
import {initProductControls} from './product-controls.js';
import {getProductSettings} from './product-state.js';

const ui = Object.fromEntries([
  'selectButton', 'status', 'preview', 'ocrInfo', 'uncertain', 'sourceText',
  'confirmButton', 'skipButton', 'translationInfo', 'translateButton',
  'targetText', 'showButton', 'originalButton', 'saveTranslationButton',
  'sampleCount', 'exportButton', 'importFile',
].map((id) => [id, document.getElementById(id)]));

const pair = {...DEFAULT_LANGUAGE_PAIR};
let controls,historyRefresh;
let current;
let selectingTabId;
let processing = false;
let sourceEditVersion = 0;
let translating = false;
let translationRequestId = 0;
let targetEditRevision = 0;
let autoTranslateTimer;

function status(message) { ui.status.textContent = message; }
function sourceText() { return ui.sourceText.value.trim(); }
function targetText() { return ui.targetText.value.trim(); }

function updateButtons() {
  const ready = Boolean(current) && !processing;
  if (ui.sourceText.disabled !== !ready) ui.sourceText.disabled = !ready;
  if (ui.targetText.disabled !== !ready) ui.targetText.disabled = !ready;
  ui.confirmButton.disabled = !ready || !sourceText() || translating;
  ui.skipButton.disabled = !ready;
  ui.translateButton.disabled = !ready || !sourceText() || translating;
  ui.showButton.disabled = !ready || !targetText();
  ui.originalButton.disabled = !ready;
  ui.saveTranslationButton.disabled = !ready || !targetText() || !current?.confirmed;
  ui.selectButton.disabled = processing;
}

async function refreshCount() {
  const count = await countLabels();
  ui.sampleCount.textContent = `${count} onaylı kaynak metin örneği kaydedildi.`;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Etkin manga sekmesi bulunamadı.');
  return tab;
}

async function startSelection() {
  try {
    const tab = await activeTab();
    selectingTabId = tab.id;
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: 'START_SELECTION' });
    } catch (error) {
      if (!/receiving end does not exist|could not establish connection/i.test(error.message)) throw error;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['features.js','text-layout.js','overlay-manager.js','content.js'] });
      response = await chrome.tabs.sendMessage(tab.id, { type: 'START_SELECTION' });
    }
    if (!response?.ok) throw new Error('Sayfada seçim başlatılamadı.');
    status('Manga sayfasında yazı alanını seç. Çıkmak için Esc.');
  } catch (error) {
    const permissionProblem = /cannot access|permission|not allowed/i.test(error.message);
    status(permissionProblem
      ? `Bu sayfaya erişim verilemedi. Normal bir manga sekmesinde eklenti simgesini kullan. Ayrıntı: ${error.message}`
      : `Seçim başlatılamadı: ${error.message}`);
  }
}

function showOcrResult(result) {
  ui.sourceText.value = result.text;
  const score = Math.round(result.confidence);
  ui.ocrInfo.textContent = `OCR güven puanı: ${score}/100 · Model: ${result.modelVersion}`;
  const uncertainWords = [...new Set(result.lowConfidenceWords.map((word) => word.text))].slice(0, 8);
  if (!result.text) {
    ui.uncertain.textContent = 'Metin okunamadı. Balonda ne yazdığını kaynak dilde yazabilirsin.';
  } else if (uncertainWords.length) {
    ui.uncertain.textContent = `Bu sözcükleri kontrol et: ${uncertainWords.join(', ')}`;
  } else if (score < 75) {
    ui.uncertain.textContent = 'Okuma belirsiz görünüyor. Kaynak metni kontrol et.';
  } else {
    ui.uncertain.hidden = true;
    return;
  }
  ui.uncertain.hidden = false;
}

async function handleSelection(message, sender) {
  if (processing || !sender.tab?.id || sender.tab.id !== selectingTabId) return;
  const tab = await activeTab();
  if (tab.id !== sender.tab.id) {
    status('Sekme değişti. Manga sekmesine dönüp alanı yeniden seç.');
    return;
  }
  processing = true;
  clearTimeout(autoTranslateTimer);
  translationRequestId += 1;
  translating = false;
  current = null;
  ui.preview.hidden = true;
  ui.preview.removeAttribute('src');
  ui.sourceText.value = '';
  ui.targetText.value = '';
  ui.uncertain.hidden = true;
  updateButtons();
  status('Seçilen alan görüntüleniyor…');
  let pendingOcrRecord,pendingOcrEditVersion;
  try {
    const screenshot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
    const cropped = await cropScreenshot(screenshot, message);
    const {ocrInput,...displayCrop}=cropped;
    current = {
      id: crypto.randomUUID(), tabId: tab.id, selectionId: message.selectionId,
      pageKey: message.pageKey, displayScale:message.rect.width/cropped.width, ...displayCrop,
      sourceLanguage: pair.source, targetLanguage: pair.target,
      confirmed: false,
    };
    ui.preview.src = cropped.imageDataUrl;
    ui.preview.hidden = false;
    ui.sourceText.value = '';
    ui.targetText.value = '';
    ui.uncertain.hidden = true;
    ui.translationInfo.textContent = 'Kaynak metni kontrol ettikten sonra Çevir düğmesine bas.';
    status('Kaynak metin okunuyor…');
    const selectionRecord=current,editVersion=sourceEditVersion;
    pendingOcrRecord=selectionRecord;pendingOcrEditVersion=editVersion;
    const ocr=await recognize(cropped.imageDataUrl,pair.source,{layout:cropped.ocrLayout,ocrInput});
    if(current!==selectionRecord)return;
    current.ocr=ocr;
    if(sourceEditVersion!==editVersion){status('Elle yazdığın metin korundu.');return;}
    showOcrResult(current.ocr);
    status('Kaynak metni kontrol et. Gerekirse düzelt.');
  } catch (error) {
    status(`Okuma başarısız: ${error.message}`);
    if (current && (!pendingOcrRecord || current===pendingOcrRecord)) {
      current.ocr = { text: '', confidence: 0, lines: [], modelVersion: 'unknown' };
      if(pendingOcrEditVersion===undefined||sourceEditVersion===pendingOcrEditVersion)ui.sourceText.value = '';
      ui.uncertain.textContent = 'OCR çalışmadı. Kaynak metni elle yazıp kaydedebilirsin.';
      ui.uncertain.hidden = false;
    }
  } finally {
    processing = false;
    updateButtons();
  }
}

function makeRecord() {
  return {
    id: current.id,
    createdAt: current.createdAt ?? new Date().toISOString(),
    pageKey: current.pageKey,
    sourceLanguage: current.sourceLanguage,
    targetLanguage: current.targetLanguage,
    modelVersion: current.ocr.modelVersion,
    imageDataUrl: current.imageDataUrl,
    imageWidth: current.width,
    imageHeight: current.height,
    ocrText: current.ocr.text,
    ocrConfidence: current.ocr.confidence,
    lineBoxes: current.ocr.lines.map((line) => line.bbox),
    correctedText: sourceText(),
    correctedTranslation: current.correctedTranslation ?? '',
    ...(current.automatic ? { automatic: current.automatic } : {}),
  };
}

async function confirmText() {
  if (!current || !sourceText()) return;
  clearTimeout(autoTranslateTimer);
  const selected = current;
  const record = makeRecord();
  const sourceRevision = selected.sourceRevision ?? 0;
  // Translator.create runs synchronously during this click, which lets Chrome
  // start a first-time language-pack download with the required user gesture.
  void translateCurrent();
  try {
    await selected.pendingDelete;
    selected.createdAt ??= record.createdAt;
    await saveLabel(record);
    if ((selected.sourceRevision ?? 0) !== sourceRevision) {
      await deleteLabel(record.id);selected.confirmed = false;await refreshCount();
      if (current === selected) status('Kaynak metin onay sırasında değişti. Yeni metni yeniden onayla.');
      updateButtons();return;
    }
    selected.confirmed = true;
    status('Doğru kaynak metin ve balon görüntüsü eğitim için kaydedildi.');
    await refreshCount();
    updateButtons();
  } catch (error) {
    status(`Düzeltme kaydedilemedi: ${error.message}`);
  }
}

async function hideCurrentOverlay() {
  if (!current) return;
  const selected = current;
  selected.overlayVisible = false;
  try {
    await chrome.tabs.sendMessage(selected.tabId, {
      type: 'HIDE_TRANSLATION', selectionId: selected.selectionId,
    });
  } catch { /* The page may have navigated away. */ }
}

function sourceChanged() {
  sourceEditVersion += 1;
  if (!current) return;
  current.sourceRevision = (current.sourceRevision ?? 0) + 1;
  if (current.autoRegionId) automatic.sourceEdited(current.autoRegionId, sourceText());
  clearTimeout(autoTranslateTimer);
  translationRequestId += 1;
  translating = false;
  current.overlayWantsRefresh = Boolean(current.overlayVisible || current.overlayWantsRefresh);
  if (current.confirmed) {
    current.pendingDelete = deleteLabel(current.id).then(refreshCount);
    current.pendingDelete.catch((error) => status(`Eski düzeltme silinemedi: ${error.message}`));
  }
  current.confirmed = false;
  current.correctedTranslation = '';
  ui.targetText.value = '';
  targetEditRevision += 1;
  ui.translationInfo.textContent = 'Kaynak metin değişti. Yeniden çevir.';
  void hideCurrentOverlay();
  updateButtons();
  if (hasTranslator(pair.source, pair.target) && sourceText()) {
    autoTranslateTimer = setTimeout(() => void translateCurrent(), 500);
  }
}

function targetChanged() {
  if (current?.autoRegionId) automatic.targetEdited(current.autoRegionId, targetText());
  targetEditRevision += 1;
  clearTimeout(autoTranslateTimer);
  if (current) current.overlayWantsRefresh = false;
  updateButtons();
}

async function translateCurrent() {
  if (!current || !sourceText()) return;
  const selected = current;
  const english = sourceText();
  const requestId = ++translationRequestId;
  const editRevision = targetEditRevision;
  translating = true;
  updateButtons();
  ui.translationInfo.textContent = 'Çeviri hazırlanıyor…';
  try {
    const translated = await translate(english, pair.source, pair.target, (percent) => {
      if (requestId === translationRequestId) {
        ui.translationInfo.textContent = `Yerel çeviri modeli indiriliyor: %${percent}`;
      }
    });
    if (requestId !== translationRequestId || current !== selected || sourceText() !== english) return;
    if (targetEditRevision !== editRevision) {
      ui.translationInfo.textContent = 'Elle yazdığın çeviri korundu.';
      return;
    }
    ui.targetText.value = translated;
    if (selected.autoRegionId) automatic.targetEdited(selected.autoRegionId, translated);
    ui.translationInfo.textContent = 'Çeviriyi kontrol edebilir ve düzeltebilirsin.';
    status('Çeviri hazır. İstersen manga sayfasında göster.');
    if (selected.overlayWantsRefresh) {
      selected.overlayWantsRefresh = false;
      await showOnPage();
    }
  } catch (error) {
    if (requestId !== translationRequestId || current !== selected) return;
    selected.overlayWantsRefresh = false;
    ui.translationInfo.textContent = `Çeviri yapılamadı: ${error.message}`;
    status('Kaynak metin ve düzeltmeler korunuyor.');
  } finally {
    if (requestId === translationRequestId) {
      translating = false;
      updateButtons();
    }
  }
}

async function showOnPage() {
  if (!current || !targetText()) return;
  if (current.autoRegionId) {
    try {
      const tab = await activeTab();
      if (tab.id !== current.tabId) throw new Error('Manga sekmesine dön.');
      await automatic.show(current.autoRegionId,targetText());
      current.overlayVisible = true;
      status('Türkçe metin manga üzerinde gösteriliyor.');
    } catch(error) { status(error.message); }
    return;
  }
  if (!current.background.color) {
    status('Bu alanın zemin rengi belirlenemedi. Yazı alanını yeniden seç.');
    return;
  }
  try {
    const tab = await activeTab();
    if (tab.id !== current.tabId) throw new Error('Manga sekmesine dön.');
    const original=current,selectionId=current.selectionId,revision=targetEditRevision;
    const region=current.inlineRegion??={bounds:{x:0,y:0,width:current.width,height:current.height},ocr:current.ocr,background:current.background.color,textColor:current.background.textColor};
    region.turkish=targetText();region.textStyle=getProductSettings().textStyle;
    await prepareRegion(region,current);
    const output=await renderPage(current.imageDataUrl,[region],{displayScale:current.displayScale??1});
    const renderedImageDataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(output);});
    if(current!==original||current.selectionId!==selectionId||targetEditRevision!==revision)throw Error('Seçim veya metin değişti; eski gösterim uygulanmadı.');
    const result = await chrome.tabs.sendMessage(current.tabId, {
      renderedImageDataUrl,
      type: 'SHOW_TRANSLATION', selectionId: current.selectionId,
      text: targetText(), background: current.background.color,
      textColor: current.background.textColor,
      textStyle: getProductSettings().textStyle,
      direction: getTargetLanguage(pair.target).direction,
      eraseBoxes: current.ocr.lines.map((line) => line.bbox).filter(Boolean),
      imageWidth: current.width,
      imageHeight: current.height,
    });
    if (!result?.ok) throw new Error(result?.reason ?? 'Çeviri yerleştirilemedi.');
    current.overlayVisible = true;
    status('Türkçe metin manga üzerinde gösteriliyor.');
  } catch (error) {
    status(error.message);
  }
}

async function saveTranslationCorrection() {
  if (!current?.confirmed || !targetText()) return;
  try {
    current.correctedTranslation = targetText();
    await saveLabel(makeRecord());
    status('Türkçe düzeltme kaydedildi. OCR eğitimi için kullanılmayacak.');
  } catch (error) {
    status(`Türkçe düzeltme kaydedilemedi: ${error.message}`);
  }
}

function skipCurrent() {
  clearTimeout(autoTranslateTimer);
  translationRequestId += 1;
  translating = false;
  void hideCurrentOverlay();
  current = null;
  ui.preview.hidden = true;
  ui.preview.removeAttribute('src');
  ui.sourceText.value = '';
  ui.targetText.value = '';
  ui.uncertain.hidden = true;
  ui.ocrInfo.textContent = 'Seçilen balonun metni burada görünecek.';
  status('Alan geçildi. Yeni bir konuşma balonu seçebilirsin.');
  updateButtons();
}

async function exportBackup() {
  try {
    const backup = { schemaVersion: 1, exportedAt: new Date().toISOString(), labels: await allLabels() };
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `manga-duzeltmeler-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    status(`${backup.labels.length} onaylı örnek dışa aktarıldı.`);
  } catch (error) {
    status(`Dışa aktarma başarısız: ${error.message}`);
  }
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const count = await importLabels(JSON.parse(await file.text()));
    await refreshCount();
    status(`${count} örnek içe aktarıldı veya güncellendi.`);
  } catch (error) {
    status(`İçe aktarma başarısız: ${error.message}`);
  } finally {
    ui.importFile.value = '';
  }
}

const automatic = initAutomatic({
  ready:()=>controls.ready,
  onStored(){clearTimeout(historyRefresh);historyRefresh=setTimeout(()=>void controls?.refreshHistory().catch(()=>{}),500);},
  onFocus(record, english, turkish) {
    clearTimeout(autoTranslateTimer);translationRequestId++;targetEditRevision++;translating=false;
    current=record;
    ui.preview.src=record.imageDataUrl;ui.preview.hidden=false;
    showOcrResult(record.ocr);ui.sourceText.value=english;ui.targetText.value=turkish;
    ui.translationInfo.textContent='Bu alanın metnini kontrol edip düzeltebilirsin.';
    updateButtons();
  },
  onText(id, english, turkish, assetId) {
    if(current?.autoRegionId!==id || current.autoAssetId!==assetId)return;
    translationRequestId++;targetEditRevision++;translating=false;
    ui.sourceText.value=english;ui.targetText.value=turkish;updateButtons();
  },
  onInvalidated(id) {
    if(current?.autoRegionId && (!id || current.autoRegionId===id)) skipCurrent();
  },
});
controls=initProductControls({
 async onChange(next,prior){
  pair.source=next.sourceLanguage;pair.target=next.targetLanguage;
  document.getElementById('languagePairLabel').textContent=`${next.sourceLanguage.toUpperCase()} → ${next.targetLanguage.toUpperCase()} · ücretsiz ve yerel`;
  document.getElementById('englishHeading').textContent='Kaynak metin';document.getElementById('turkishHeading').textContent='Çeviri';
  if(prior){
   const identityChanged=next.sourceLanguage!==prior.sourceLanguage||next.targetLanguage!==prior.targetLanguage||next.series!==prior.series||JSON.stringify(next.glossaries)!==JSON.stringify(prior.glossaries);
   if(identityChanged){await automatic.reset();skipCurrent();releaseTranslators(next.sourceLanguage,next.targetLanguage);}
   else if(JSON.stringify(next.textStyle)!==JSON.stringify(prior.textStyle))await automatic.restyle();
  }
 },
 async onExport(chapter){const pages=await automatic.exportPages(chapter);const {createArchive,downloadBlob}=await import('./archive.js');downloadBlob(chapter?await createArchive(pages):pages[0].blob,chapter?'manga-bolum.zip':pages[0].name);controls.status(pages.length+' sayfa dışa aktarıldı.');},
 async onImport(files){if(!files.length)return;automatic.stop('Yerel dosyalar açılıyor.');skipCurrent();const {readLocalFiles}=await import('./archive.js');const pages=await readLocalFiles(files);const {openLocalWorkspace}=await import('./local-workspace.js');await openLocalWorkspace(pages,{getSettings:getProductSettings,onStatus:controls.status});},
 onFill:()=>automatic.fillFocused(),onUndo:()=>automatic.undo(),
});
ui.selectButton.addEventListener('click', () => {
  automatic.stop('Elle balon seçimi açıldı.');
  void startSelection();
});
ui.confirmButton.addEventListener('click', confirmText);
ui.skipButton.addEventListener('click', skipCurrent);
ui.translateButton.addEventListener('click', translateCurrent);
ui.showButton.addEventListener('click', showOnPage);
ui.originalButton.addEventListener('click', async () => {
  if (current) current.overlayWantsRefresh = false;
  await hideCurrentOverlay();
  status('Özgün manga görüntüsü gösteriliyor.');
});
ui.saveTranslationButton.addEventListener('click', saveTranslationCorrection);
ui.sourceText.addEventListener('input', sourceChanged);
ui.targetText.addEventListener('input', targetChanged);
ui.exportButton.addEventListener('click', exportBackup);
ui.importFile.addEventListener('change', importBackup);
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'SELECTION_COMPLETE') void handleSelection(message, sender);
  if (message?.type === 'SELECTION_CANCELLED' && sender.tab?.id === selectingTabId) {
    status(message.reason);
  }
  if (message?.type === 'OVERLAY_LOST' && message.selectionId === current?.selectionId) {
    status('Manga görseli değişti veya metin alana sığmadı. Alanı yeniden seç.');
  }
});

void refreshCount().catch((error) => status(`Kayıtlar açılamadı: ${error.message}`));
void checkTranslationAvailability(pair.source, pair.target).then((availability) => {
  ui.translationInfo.textContent = availability === 'available'
    ? 'Yerel çeviri hazır.'
    : availability === 'downloadable' || availability === 'downloading'
      ? 'İlk çeviride Chrome dil modelini indirebilir.'
      : 'Bu Chrome kurulumunda seçilen yerel dil çifti kullanılamıyor.';
}).catch((error) => {
  ui.translationInfo.textContent = `Çeviri durumu kontrol edilemedi: ${error.message}`;
});
updateButtons();
window.addEventListener('pagehide',()=>releaseTranslators());

chrome.runtime.onMessage.addListener((message,sender)=>{if(message?.type==='MANGA_SETTINGS_REFRESH'&&sender.id===chrome.runtime.id&&!sender.tab)void controls.reload().catch(error=>controls.status('Ayarlar açılamadı: '+error.message));});
