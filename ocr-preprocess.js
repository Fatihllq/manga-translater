export const PREPROCESS_VERSION='ocr-preparation-v2-20261010';
export const BASE_RECIPE='original-p0-t0';
export const PREPROCESS_RECIPES=Object.freeze(['original','invert','contrast','channel'].flatMap(tone=>[0,10].flatMap(padding=>['0','1','2'].map(thresholdingMethod=>Object.freeze({id:`${tone}-p${padding}-t${thresholdingMethod}`,tone,padding,thresholdingMethod})))));
export const recipeById=id=>PREPROCESS_RECIPES.find(r=>r.id===id);
const luminance=(r,g,b)=>(77*r+150*g+29*b+128)>>8;
const percentile=(hist,total,f)=>{let n=0;for(let i=0;i<256;i++){n+=hist[i];if(n>=total*f)return i;}return 255;};
export function otsuSeparation(hist){
 let count=0,sum=0,sum2=0;for(let i=0;i<256;i++){count+=hist[i];sum+=i*hist[i];sum2+=i*i*hist[i];}
 if(!count)return 0;let left=0,leftSum=0,best=0;
 for(let i=0;i<255;i++){left+=hist[i];leftSum+=i*hist[i];const right=count-left;if(!left||!right)continue;const d=leftSum/left-(sum-leftSum)/right;best=Math.max(best,left*right*d*d/(count*count));}
 const variance=sum2/count-(sum/count)**2;return variance>0?best/variance:0;
}
export const POLARITY_PROFILES=Object.freeze([32,48].flatMap(difference=>[.8,.9].map(dominance=>Object.freeze({id:`d${difference}-r${Math.round(dominance*100)}`,difference,dominance}))));
export const DEFAULT_POLARITY_PROFILE=POLARITY_PROFILES[3];
// Components are excluded only from this analysis copy. The OCR pixels stay intact.
function interiorPolarity(rgb,width,height,background){
 const n=width*height,bgY=luminance(...background),mask=new Uint8Array(n),seen=new Uint8Array(n),queue=new Int32Array(n),samples=[];
 for(let i=0;i<n;i++){const j=i*3,delta=luminance(rgb[j],rgb[j+1],rgb[j+2])-bgY;
  if(Math.abs(delta)>=32&&Math.abs(rgb[j]-background[0])+Math.abs(rgb[j+1]-background[1])+Math.abs(rgb[j+2]-background[2])>=65)mask[i]=1;
 }
 let excludedEdgePixels=0,excludedLargePixels=0,components=0;
 for(let i=0;i<n;i++){
  if(!mask[i]||seen[i])continue;let head=0,tail=1,edge=false,x0=width,y0=height,x1=0,y1=0;queue[0]=i;seen[i]=1;
  while(head<tail){const at=queue[head++],x=at%width,y=Math.floor(at/width);edge||=x===0||y===0||x===width-1||y===height-1;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
   for(const next of [x?at-1:-1,x+1<width?at+1:-1,y?at-width:-1,y+1<height?at+width:-1])if(next>=0&&mask[next]&&!seen[next]){seen[next]=1;queue[tail++]=next;}
  }
  if(edge){excludedEdgePixels+=tail;continue;}
  if(tail>n*.35||(x1-x0+1)>width*.95||(y1-y0+1)>height*.95){excludedLargePixels+=tail;continue;}
  if(tail<Math.max(2,Math.floor(n*.00002)))continue;components++;
  for(let j=0;j<tail;j++)samples.push(queue[j]);
 }
 const evidence=POLARITY_PROFILES.map(profile=>{
  let light=0,dark=0;const lightRgb=[0,0,0],darkRgb=[0,0,0];
  for(const i of samples){const j=i*3,delta=luminance(rgb[j],rgb[j+1],rgb[j+2])-bgY;
   const target=delta>=profile.difference?lightRgb:delta<=-profile.difference?darkRgb:null;if(!target)continue;
   if(target===lightRgb)light++;else dark++;for(let k=0;k<3;k++)target[k]+=rgb[j+k];
  }
  const count=light+dark,ratio=count?Math.max(light,dark)/count:0,polarity=count>=Math.max(8,n*.0005)&&ratio>=profile.dominance?(light>dark?'light-on-dark':'dark-on-light'):'uncertain';
  const winning=light>dark?lightRgb:darkRgb,winningCount=Math.max(light,dark),foreground=winning.map(v=>winningCount?Math.round(v/winningCount):0);
  const channelContrast=foreground.map((v,k)=>Math.abs(background[k]-v));let channel=0;for(let k=1;k<3;k++)if(channelContrast[k]>channelContrast[channel])channel=k;
  return {...profile,polarity,lightPixels:light,darkPixels:dark,dominanceRatio:ratio,foreground,channel,channelContrast};
 });
 return {components,interiorPixels:samples.length,excludedEdgePixels,excludedLargePixels,evidence};
}
export function polarityDecision(features,profile=DEFAULT_POLARITY_PROFILE){
 const selected=POLARITY_PROFILES.find(p=>p.difference===profile?.difference&&p.dominance===profile?.dominance);
 const evidence=features?.polarity?.evidence.find(p=>p.id===selected?.id);
 if(!features||features.flat<.45||!evidence||evidence.polarity==='uncertain')return {kind:'original',reason:'insufficient-interior-glyph-evidence',polarity:'uncertain',profile:selected?.id};
 if(evidence.polarity==='light-on-dark')return {kind:'dark',reason:'interior-glyphs-lighter-than-background',polarity:evidence.polarity,profile:selected.id,channel:null};
 if(Math.max(...features.background)-Math.min(...features.background)>=40)return {kind:'color',reason:'interior-dark-glyphs-on-colored-background',polarity:evidence.polarity,profile:selected.id,channel:evidence.channel};
 return {kind:'original',reason:'ordinary-dark-glyphs-on-neutral-background',polarity:evidence.polarity,profile:selected.id,channel:null};
}
export function analyzePreparationPixels({data,width,height},profile=DEFAULT_POLARITY_PROFILE){
 if(!data||width<1||height<1||width*height>256*256||data.length!==width*height*4)return {version:PREPROCESS_VERSION,invalid:true,kind:'original'};
 const n=width*height,bins=new Uint32Array(32768),hists=Array.from({length:4},()=>new Uint32Array(256)),rgb=new Uint8Array(n*3);let chroma=0;
 for(let i=0;i<n;i++){const at=i*4,a=data[at+3]/255,c=[];for(let k=0;k<3;k++){c[k]=Math.round(data[at+k]*a+255*(1-a));rgb[i*3+k]=c[k];hists[k][c[k]]++;}hists[3][luminance(...c)]++;if(Math.max(...c)-Math.min(...c)>=40)chroma++;bins[(c[0]>>3)*1024+(c[1]>>3)*32+(c[2]>>3)]++;}
 let bin=0;for(let i=1;i<bins.length;i++)if(bins[i]>bins[bin])bin=i;
 const bg=[0,0,0];let matched=0;for(let i=0;i<n;i++){const j=i*3;if(((rgb[j]>>3)*1024+(rgb[j+1]>>3)*32+(rgb[j+2]>>3))!==bin)continue;for(let k=0;k<3;k++)bg[k]+=rgb[j+k];matched++;}for(let k=0;k<3;k++)bg[k]/=Math.max(1,matched);
 let flat=0;const tileSum=new Float64Array(64),tileCount=new Uint32Array(64);
 for(let i=0;i<n;i++){const j=i*3,d=Math.abs(rgb[j]-bg[0])+Math.abs(rgb[j+1]-bg[1])+Math.abs(rgb[j+2]-bg[2]);if(d<65)flat++;const x=i%width,y=Math.floor(i/width),tile=Math.min(7,Math.floor(y*8/height))*8+Math.min(7,Math.floor(x*8/width));tileSum[tile]+=luminance(rgb[j],rgb[j+1],rgb[j+2]);tileCount[tile]++;}
 const means=Array.from(tileSum,(s,i)=>tileCount[i]?s/tileCount[i]:null).filter(v=>v!==null),mean=means.reduce((a,b)=>a+b,0)/means.length;
 const scores=hists.map(otsuSeparation);let channel=0;for(let i=1;i<3;i++)if(scores[i]>scores[channel])channel=i;
 const f={background:bg.map(Math.round),backgroundY:luminance(...bg.map(Math.round)),flat:flat/n,chromaFraction:chroma/n,
  p02:percentile(hists[3],n,.02),p05:percentile(hists[3],n,.05),p95:percentile(hists[3],n,.95),p98:percentile(hists[3],n,.98),
  channel,channelScore:scores[channel],greyScore:scores[3],tileVariation:Math.sqrt(means.reduce((s,v)=>s+(v-mean)**2,0)/means.length)};
 f.contrast=f.p95-f.p05;f.polarity=interiorPolarity(rgb,width,height,f.background);const decision=polarityDecision(f,profile);if(decision.channel!==null&&decision.channel!==undefined)f.channel=decision.channel;return {version:PREPROCESS_VERSION,width,height,features:f,kind:decision.kind,decision};
}
export function preparationKind(f,profile=DEFAULT_POLARITY_PROFILE){return polarityDecision(f,profile).kind;}
export function eligibleRecipe(recipe,kind){
 if(!recipe||kind==='original')return recipe?.id===BASE_RECIPE;
 return recipe.tone==='original'||recipe.tone==='invert'&&kind==='dark'||recipe.tone==='contrast'&&kind==='lowContrast'||recipe.tone==='channel'&&kind==='color';
}
export function transformPreparationPixels({data,width,height},recipe,features){
 if(!recipe||!features||data.length!==width*height*4)throw Error('Invalid preparation');
 const p=recipe.padding,w=width+p*2,h=height+p*2,out=new Uint8ClampedArray(w*h*4);
 const span=features.p98-features.p02,gain=span>=16?Math.min(2,255/span):1;
 const tone=c=>{if(recipe.tone==='invert')return c.map(v=>255-v);if(recipe.tone==='channel')return [c[features.channel],c[features.channel],c[features.channel]];
  if(recipe.tone==='contrast'){const y=Math.max(0,Math.min(255,Math.round((luminance(...c)-features.p02)*gain)));return [y,y,y];}return c;};
 const background=tone(features.background);
 for(let i=0;i<w*h;i++){const j=i*4;out[j]=background[0];out[j+1]=background[1];out[j+2]=background[2];out[j+3]=255;}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,j=((y+p)*w+x+p)*4,a=data[i+3]/255;
  const c=tone([0,1,2].map(k=>Math.round(data[i+k]*a+255*(1-a))));for(let k=0;k<3;k++)out[j+k]=c[k];}
 return {data:out,width:w,height:h};
}
export function originalBox(box,padding,width,height){
 if(!box)return box;const b={x0:Math.max(0,Math.min(width,box.x0-padding)),y0:Math.max(0,Math.min(height,box.y0-padding)),x1:Math.max(0,Math.min(width,box.x1-padding)),y1:Math.max(0,Math.min(height,box.y1-padding))};
 return Object.values(b).every(Number.isFinite)&&b.x1>b.x0&&b.y1>b.y0?b:undefined;
}
export function restorePreparationBoxes(result,input){
 if(!input?.padding)return result;
 const lines=result.lines.map(l=>({...l,bbox:originalBox(l.bbox,input.padding,input.originalWidth,input.originalHeight),words:l.words.map(w=>({...w,bbox:originalBox(w.bbox,input.padding,input.originalWidth,input.originalHeight)}))}));
 return {...result,lines,lowConfidenceWords:lines.flatMap(l=>l.words).filter(w=>w.text&&w.confidence<75)};
}
export function validatedOcrInput(input,version,policy){
 if(!policy?.enabled||version!==policy.modelVersion||!input||input.policyVersion!==policy.version||input.modelVersion!==version)return null;
 const route=policy.routes?.[input.kind],recipe=recipeById(input.profile);
 if(!route||route.recipe!==input.profile||!eligibleRecipe(recipe,input.kind)||!input.imageDataUrl||input.padding!==recipe.padding||!Number.isFinite(input.originalWidth)||!Number.isFinite(input.originalHeight)||!Number.isInteger(input.originalWidth)||!Number.isInteger(input.originalHeight)||input.originalWidth<=0||input.originalHeight<=0||input.originalWidth*input.originalHeight>4194304||input.width!==input.originalWidth+2*recipe.padding||input.height!==input.originalHeight+2*recipe.padding)return null;
 return {...input,thresholdingMethod:recipe.thresholdingMethod,retryOriginal:route.retryOriginal===true};
}
