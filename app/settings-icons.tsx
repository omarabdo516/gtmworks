// The settings overlay's line icons, copied from the approved reference (design-reference/app.js, ICONS): 24px box,
// 1.75 stroke. Chevrons point the reading direction: the reference swaps them in English (FLIP).
const paths = {
 building: <path d="M4.5 20.5h15M6.5 20.5V5.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15M14.5 9.5h3a1 1 0 0 1 1 1v10M9.5 8h2M9.5 11.5h2M9.5 15h2"/>,
 bot: <><rect x="5" y="7.5" width="14" height="11" rx="3"/><path d="M12 4.5v3M9.5 12.5v1M14.5 12.5v1"/></>,
 book: <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 8h6"/>,
 bulb: <><path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"/></>,
 cpu: <><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 2.5v3M14 2.5v3M10 18.5v3M14 18.5v3M2.5 10h3M2.5 14h3M18.5 10h3M18.5 14h3"/></>,
 plug: <><path d="M9 3.5v4.5M15 3.5v4.5"/><path d="M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 17v3.5"/></>,
 repeat: <><path d="M17 3l3 3-3 3"/><path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4"/></>,
 gauge: <><path d="M4 17.5a8 8 0 1 1 16 0"/><path d="M12 17.5l3.5-5"/></>,
 archive: <><rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-10M10 12.5h4"/></>,
 user: <><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></>,
 x: <path d="M6 6l12 12M18 6L6 18"/>,
 chat: <path d="M4 5.5h16v10.5H9l-5 4z"/>,
 shield: <path d="M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z"/>,
 eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></>,
 check: <path d="M5 12.5l4.5 4.5L19 7.5"/>,
 team: <><circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M16.2 14.6a4.5 4.5 0 0 1 4.3 4.4"/></>,
 moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>,
 sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></>,
 plus: <path d="M12 5v14M5 12h14"/>,
 forward: <path d="M15 6l-6 6 6 6"/>,
 back: <path d="M9 6l6 6-6 6"/>,
};
export type SettingsIconName = keyof typeof paths;
// `forward` points where reading goes (left in Arabic), `back` the other way; English swaps them, as the reference does.
export function SettingsIcon({name,rtl=true,className=''}:{name:SettingsIconName,rtl?:boolean,className?:string}) {
 const shown=!rtl&&name==='forward'?'back':!rtl&&name==='back'?'forward':name;
 return <svg className={`sov-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[shown]}</svg>;
}
