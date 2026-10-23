import type {Page} from '@playwright/test';
/** Synthetic live camera frames; never opens the machine's real camera or a gallery. */
export async function syntheticCamera(page:Page){
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
   const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;
   const draw=()=>{const ctx=canvas.getContext('2d')!;ctx.fillStyle='#365870';ctx.fillRect(0,0,800,600);ctx.fillStyle='#c8d8e8';ctx.fillRect(300,100,200,300);};draw();
   const stream=canvas.captureStream(10),timer=setInterval(draw,100);for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};}return stream;
  }}});
 });
}
