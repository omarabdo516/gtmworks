// The one place that asks whether the person wants less motion (design-reference/app.js: reduced, later). Read at the
// moment of use, so a change of the setting applies to the next scroll or wait without a reload.
export function prefersReducedMotion(): boolean {
 return typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// A wait before the page moves on: at most 120ms for a person who wants less motion. Returns the timer, for clearTimeout.
export function later(ms:number,run:()=>void): number {
 return window.setTimeout(run,prefersReducedMotion()?Math.min(ms,120):ms);
}

// Something that leaves with the design's exit animation (design-reference: closeSheet, toast): its leaving look starts
// and it is gone once the animation has run; with reduced motion it is gone at once, with no leaving look. Returns what
// cancels a removal still pending.
export function leave(ms:number,start:()=>void,gone:()=>void):()=>void {
 if(prefersReducedMotion()) { gone(); return ()=>{}; }
 start();
 const timer=window.setTimeout(gone,ms);
 return ()=>clearTimeout(timer);
}
