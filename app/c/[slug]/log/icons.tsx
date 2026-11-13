// The reference's line icons used by the Activity log and Numbers pages (design-reference/app.js, ICONS), drawn the
// same way as components/shell-icon.tsx: 24px box, 1.75 stroke, current colour.
const paths = {
 board: <><rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="10.5" y="4" width="5" height="10" rx="1.5"/><rect x="17.5" y="4" width="3.5" height="13" rx="1.5"/></>,
 lock: <><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></>,
 // The reference's arrow points to the reading direction's end: left in Arabic, mirrored in English (log.css).
 arrow: <><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></>,
 plug: <><path d="M9 3.5v4.5M15 3.5v4.5"/><path d="M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 17v3.5"/></>,
 up: <path d="M7 14l5-5 5 5"/>,
 down: <path d="M7 10l5 5 5-5"/>,
};
export type PageIconName = keyof typeof paths;
export function PageIcon({name,className=''}:{name:PageIconName,className?:string}) {
 return <svg className={`pg-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
// gtmworks itself, for rows nobody made by hand (design-reference: SYS_MARK).
export function SystemMark({size=28}:{size?:number}) {
 return <svg className="lg-sys" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--gw-accent)"/><path d="M21.5 11.5a7 7 0 1 0 1 7.5h-6.5" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
