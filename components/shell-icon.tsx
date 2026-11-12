// The reference's line icons (design-reference/app.js, ICONS), drawn the same way: 24px box, 1.75 stroke.
const paths = {
 chat: <path d="M4 5.5h16v10.5H9l-5 4z"/>,
 board: <><rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="10.5" y="4" width="5" height="10" rx="1.5"/><rect x="17.5" y="4" width="3.5" height="13" rx="1.5"/></>,
 chart: <><path d="M4 20h17"/><path d="M6.5 16v-5"/><path d="M11.5 16V6"/><path d="M16.5 16v-8"/></>,
 history: <><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4.5V9h4.5"/><path d="M12 8v4.5l3 2"/></>,
 search: <><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></>,
 compose: <><path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></>,
 menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
 sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></>,
 moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>,
 up: <path d="M7 14l5-5 5 5"/>,
 plus: <path d="M12 5v14M5 12h14"/>,
 send: <><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></>,
 check: <path d="M5 12.5l4.5 4.5L19 7.5"/>,
 gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
 eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></>,
};
export type ShellIconName = keyof typeof paths;
export function ShellIcon({name,className=''}:{name:ShellIconName,className?:string}) {
 return <svg className={`gw-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
