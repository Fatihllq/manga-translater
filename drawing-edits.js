import './text-layout.js';

export const drawingCommands=globalThis.__mangaTextLayout.drawingCommands;

export function drawCommands(context,commands){
 for(const command of commands){
  context.beginPath();
  if(command.type==='rect')context.rect(command.x,command.y,command.width,command.height);
  else if(command.type==='circle')context.arc(command.cx,command.cy,command.r,0,Math.PI*2);
  else if(command.type==='path'){
   const path=new Path2D(command.path);
   if(command.stroke){context.strokeStyle=command.stroke;context.lineWidth=command.width;context.lineCap='round';context.lineJoin='round';context.stroke(path);}
   else{context.fillStyle=command.fill;context.fill(path);}continue;
  }else throw Error('Çizim komutu tanınmadı.');
  context.fillStyle=command.fill;context.fill();
 }
}
