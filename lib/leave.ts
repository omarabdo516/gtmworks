// Something that leaves with the design's exit animation (design-reference: reduced(), closeSheet, toast): its leaving
// look starts and it is gone once the animation has run; with reduced motion it is gone at once, with no leaving look.
// Returns what cancels a removal still pending.
export function leave(ms:number,start:()=>void,gone:()=>void):()=>void {
 if(matchMedia('(prefers-reduced-motion: reduce)').matches) { gone(); return ()=>{}; }
 start();
 const timer=setTimeout(gone,ms);
 return ()=>clearTimeout(timer);
}
