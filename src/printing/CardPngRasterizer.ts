import type sharp from 'sharp';
/** PassCardRenderer paints an opaque white card. Avoid encoding an unused alpha
 * channel; leave the source photos and transparent brand assets untouched. */
export function rasterizeCardPng(engine:typeof sharp,svg:Buffer):Promise<Buffer>{
 return engine(svg,{density:300}).resize(1712,1080).removeAlpha().png().toBuffer();
}
