/* Map the visible object-fit:cover preview back to original image pixels. */
function photoCropSource(width,height,preview,frame,flipped=false){
 if(![width,height,preview.width,preview.height,frame.width,frame.height].every(n=>Number.isFinite(n)&&n>0)||![preview.left,preview.top,frame.left,frame.top].every(Number.isFinite))throw new Error('Invalid photo crop.');
 const scale=Math.max(preview.width/width,preview.height/height),left=preview.left+(preview.width-width*scale)/2,top=preview.top+(preview.height-height*scale)/2;
 const sw=frame.width/scale,sh=frame.height/scale;let sx=(frame.left-left)/scale,sy=(frame.top-top)/scale;
 if(sx<-.5||sy<-.5||sx+sw>width+.5||sy+sh>height+.5)throw new Error('Keep the photo inside the frame.');
 sx=Math.max(0,Math.min(sx,width-sw));sy=Math.max(0,Math.min(sy,height-sh));
 return{sx:flipped?width-sx-sw:sx,sy,sw,sh};
}
