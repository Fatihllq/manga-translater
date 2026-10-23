import './features.js';
import {analyzeOcrCanvas} from './ocr-layout.js';
function loadImage(dataUrl, {signal} = {}) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => { image.onload = image.onerror = null; signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); image.src = ''; reject(new DOMException('Durduruldu.', 'AbortError')); };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error('Ekran görüntüsü açılamadı.')); };
    signal?.addEventListener('abort', abort, {once:true});
    if(signal?.aborted){abort();return;}
    image.src = dataUrl;
  });
}

export async function cropScreenshot(screenshotDataUrl, selection) {
  const image = await loadImage(screenshotDataUrl);
  const { rect, viewport } = selection;
  const scaleX = image.naturalWidth / viewport.width;
  const scaleY = image.naturalHeight / viewport.height;
  const sx = Math.max(0, Math.floor(rect.left * scaleX));
  const sy = Math.max(0, Math.floor(rect.top * scaleY));
  const sw = Math.min(image.naturalWidth - sx, Math.ceil(rect.width * scaleX));
  const sh = Math.min(image.naturalHeight - sy, Math.ceil(rect.height * scaleY));
  if (sw < 8 || sh < 8) throw new Error('Seçilen alan çok küçük.');

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  const background = sampleBackground(context, sw, sh);
  const scale = globalThis.__mangaFeatures.paddleOnly ? 1 : Math.max(1, Math.min(4, Math.floor(300 / Math.min(sw, sh)), Math.floor(2048 / Math.max(sw, sh))));
  const ocrCanvas = document.createElement('canvas');
  ocrCanvas.width = sw * scale;
  ocrCanvas.height = sh * scale;
  const ocrContext = ocrCanvas.getContext('2d',globalThis.__mangaFeatures.paddleOnly?{willReadFrequently:true}:undefined);
  ocrContext.imageSmoothingQuality = 'high';
  ocrContext.drawImage(canvas, 0, 0, ocrCanvas.width, ocrCanvas.height);
  return {
    imageDataUrl: ocrCanvas.toDataURL('image/png'),
    background,
    width: ocrCanvas.width,
    height: ocrCanvas.height,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function sampleBackground(context, width, height) {
  const { data } = context.getImageData(0, 0, width, height);
  const samples = [];
  const clusters = new Map();
  const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 80));
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const weight = x >= width * 0.2 && x <= width * 0.8 &&
        y >= height * 0.2 && y <= height * 0.8 ? 2 : 1;
      const key = `${r >> 5}:${g >> 5}:${b >> 5}`;
      clusters.set(key, (clusters.get(key) ?? 0) + weight);
      samples.push({ r, g, b, key });
    }
  }
  if (samples.length < 20) return { color: null, solid: false, textColor: '#171717' };
  const dominant = [...clusters].sort((a, b) => b[1] - a[1])[0][0];
  const matching = samples.filter((pixel) => pixel.key === dominant);
  const r = median(matching.map((pixel) => pixel.r));
  const g = median(matching.map((pixel) => pixel.g));
  const b = median(matching.map((pixel) => pixel.b));
  const similar = samples.filter((pixel) =>
    Math.abs(pixel.r - r) + Math.abs(pixel.g - g) + Math.abs(pixel.b - b) < 65).length;
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return {
    color: `rgb(${r}, ${g}, ${b})`,
    solid: similar / samples.length >= 0.45,
    textColor: luminance < 145 ? '#fff' : '#171717',
  };
}


export async function loadSourceImage(blob, options = {}) {
  const url = URL.createObjectURL(blob);
  try { return {image: await loadImage(url, options), url}; }
  catch(error) { URL.revokeObjectURL(url); throw error; }
}
export async function cropSourceImage(image, bounds, options={}) {
  const sx=Math.max(0,Math.floor(bounds.x)),sy=Math.max(0,Math.floor(bounds.y));
  const right=Math.min(image.naturalWidth,Math.ceil(bounds.x+bounds.width));
  const bottom=Math.min(image.naturalHeight,Math.ceil(bounds.y+bounds.height));
  const sw=right-sx,sh=bottom-sy;
  if(sw<8 || sh<8) throw new Error('Yazı alanı çok küçük.');
  const canvas=document.createElement('canvas');canvas.width=sw;canvas.height=sh;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(image,sx,sy,sw,sh,0,0,sw,sh);
  const background=sampleBackground(ctx,sw,sh);
  // Automatic erasure requires a flat interior and matching edges, beyond the
  // more permissive manual background estimate. Free text never erases artwork.
  const rgb=background.color?.match(/\d+/g)?.map(Number), data=ctx.getImageData(0,0,sw,sh).data;
  let total=0,matching=0,edges=0,matchingEdges=0;
  if(rgb) for(let y=0;y<sh;y+=Math.max(1,Math.floor(sh/100))) for(let x=0;x<sw;x+=Math.max(1,Math.floor(sw/100))) {
    const offset=(y*sw+x)*4;
    const match=Math.abs(data[offset]-rgb[0])+Math.abs(data[offset+1]-rgb[1])+Math.abs(data[offset+2]-rgb[2])<45;
    total++;if(match)matching++;
    if(x<sw*.07||x>sw*.93||y<sh*.07||y>sh*.93){edges++;if(match)matchingEdges++;}
  }
  background.flatForAutomatic=matching/Math.max(1,total)>=.72 && matchingEdges/Math.max(1,edges)>=.9;
  const scale=globalThis.__mangaFeatures.paddleOnly?1:Math.max(1,Math.min(4,Math.floor(300/Math.min(sw,sh)),Math.floor(2048/Math.max(sw,sh))));
  const ocrCanvas=document.createElement('canvas');ocrCanvas.width=sw*scale;ocrCanvas.height=sh*scale;
  const ocrContext=ocrCanvas.getContext('2d',globalThis.__mangaFeatures.paddleOnly?{willReadFrequently:true}:undefined);ocrContext.imageSmoothingQuality='high';
  ocrContext.drawImage(canvas,0,0,ocrCanvas.width,ocrCanvas.height);
  try{return {imageDataUrl:ocrCanvas.toDataURL('image/png'),background,
    ocrLayout:options.analyzeLayout?analyzeOcrCanvas(ocrCanvas):undefined,
    width:ocrCanvas.width,height:ocrCanvas.height,sourceBounds:{x:sx,y:sy,width:sw,height:sh}};
  }finally{canvas.width=canvas.height=ocrCanvas.width=ocrCanvas.height=1;}
}
