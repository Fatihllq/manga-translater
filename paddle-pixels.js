// Browser adaptation of RapidOCR 3.10.0 image operations, modified for local JS.
// Copyright (c) 2021 RapidOCR Authors. Apache-2.0; see vendor/paddle/NOTICE.txt.
// Pixel rounding differs from the OpenCV reference; experimental, disabled.
export const bankersRound=n=>{const f=Math.floor(n),d=n-f;return d===.5?(f%2?f+1:f):Math.round(n);};
export function resizeRgba(input,w,h){
 if(w===input.width&&h===input.height)return input;
 const {data,width:iw,height:ih}=input,out=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++){const fy=(y+.5)*ih/h-.5,y0=Math.max(0,Math.floor(fy)),y1=Math.min(ih-1,y0+1),ay=Math.max(0,fy-y0);
  for(let x=0;x<w;x++){const fx=(x+.5)*iw/w-.5,x0=Math.max(0,Math.floor(fx)),x1=Math.min(iw-1,x0+1),ax=Math.max(0,fx-x0);
   const at=(y*w+x)*4;for(let c=0;c<3;c++)out[at+c]=Math.floor(((1-ay)*((1-ax)*data[(y0*iw+x0)*4+c]+ax*data[(y0*iw+x1)*4+c])+ay*((1-ax)*data[(y1*iw+x0)*4+c]+ax*data[(y1*iw+x1)*4+c]))+.5);out[at+3]=255;
  }
 }return {data:out,width:w,height:h};
}
export function preprocessGlobal(input){
 const original={width:input.width,height:input.height};let image=input;
 for(const [side,mode]of [[2000,'max'],[30,'min']]){
  const value=mode==='max'?Math.max(image.width,image.height):Math.min(image.width,image.height);
  if(mode==='max'?value>side:value<side){const ratio=side/value;
   image=resizeRgba(image,Math.max(32,bankersRound(Math.floor(image.width*ratio)/32)*32),Math.max(32,bankersRound(Math.floor(image.height*ratio)/32)*32));}
 }return {image,scaleX:original.width/image.width,scaleY:original.height/image.height,original};
}
export function verticalPadding(image){
 const {width:w,height:h}=image;if(h>30&&w/h<=8)return {image,top:0};
 const top=Math.floor(Math.abs(Math.max(Math.floor(w/8),30)*2-h)/2),out=new Uint8ClampedArray(w*(h+2*top)*4);
 for(let i=0;i<w*(h+2*top);i++)out[i*4+3]=255;out.set(image.data,top*w*4);
 return {image:{width:w,height:h+top*2,data:out},top};
}
export function bgrTensor(image,w,h,paddedWidth=w){
 const scaled=resizeRgba(image,w,h),pixels=paddedWidth*h,out=new Float32Array(pixels*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++)out[c*pixels+y*paddedWidth+x]=(scaled.data[(y*w+x)*4+2-c]/255-.5)/.5;
 return {data:out,dims:[1,3,h,paddedWidth]};
}
export function recognitionTensor(image){
 const height=48,width=Math.max(320,Math.floor(height*image.width/image.height)),resized=Math.min(width,Math.ceil(height*image.width/image.height));
 return {...bgrTensor(image,resized,height,width),contentWidth:resized};
}
function solve(matrix,values){
 const n=values.length,a=matrix.map((r,i)=>[...r,values[i]]);
 for(let i=0;i<n;i++){let best=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[best][i]))best=j;
  [a[i],a[best]]=[a[best],a[i]];if(Math.abs(a[i][i])<1e-12)throw Error('Degenerate text quadrilateral');
  const d=a[i][i];for(let k=i;k<=n;k++)a[i][k]/=d;
  for(let j=0;j<n;j++)if(j!==i){const scale=a[j][i];for(let k=i;k<=n;k++)a[j][k]-=scale*a[i][k];}
 }return a.map(r=>r[n]);
}
function homography(src,dst){const m=[],v=[];for(let i=0;i<4;i++){const [x,y]=src[i],[u,w]=dst[i];m.push([x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-w*x,-w*y]);v.push(u,w);}return solve(m,v);}
const cubic=t=>{t=Math.abs(t);return t<=1?(1.25*t-2.25)*t*t+1:t<2?((-.75*t+3.75)*t-6)*t+3:0;};
export function perspectiveCrop(input,quad){
 let width=Math.floor(Math.max(Math.hypot(quad[0][0]-quad[1][0],quad[0][1]-quad[1][1]),Math.hypot(quad[2][0]-quad[3][0],quad[2][1]-quad[3][1]))),
  height=Math.floor(Math.max(Math.hypot(quad[0][0]-quad[3][0],quad[0][1]-quad[3][1]),Math.hypot(quad[1][0]-quad[2][0],quad[1][1]-quad[2][1])));
 if(width<1||height<1)throw Error('Empty text quadrilateral');
 const H=homography([[0,0],[width,0],[width,height],[0,height]],quad),data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const d=H[6]*x+H[7]*y+1,fx=(H[0]*x+H[1]*y+H[2])/d,fy=(H[3]*x+H[4]*y+H[5])/d;
  // OpenCV warpPerspective uses a 1/32 interpolation table and replicated edges.
  const xx=Math.round(fx*32)/32,yy=Math.round(fy*32)/32,x0=Math.floor(xx),y0=Math.floor(yy),at=(y*width+x)*4;
  for(let c=0;c<3;c++){let value=0;for(let dy=-1;dy<=2;dy++)for(let dx=-1;dx<=2;dx++){
   const sx=Math.max(0,Math.min(input.width-1,x0+dx)),sy=Math.max(0,Math.min(input.height-1,y0+dy));
   value+=input.data[(sy*input.width+sx)*4+c]*cubic(xx-x0-dx)*cubic(yy-y0-dy);
  }data[at+c]=Math.round(value);}data[at+3]=255;
 }
 let image={data,width,height},rotated=false;
 if(height/width>=1.5){const out=new Uint8ClampedArray(data.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++)out.set(data.subarray((y*width+x)*4,(y*width+x+1)*4),((width-1-x)*height+y)*4);image={data:out,width:height,height:width};rotated=true;}
 return {image,rotated};
}
