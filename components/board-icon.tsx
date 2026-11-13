// The reference's line icons the board uses (design-reference/app.js, ICONS), drawn the same way: 24px box, 1.75 stroke.
// "back" and "forward" are drawn for right-to-left reading; board.css mirrors them in English.
const paths = {
 back: <path d="M9 6l6 6-6 6"/>,
 forward: <path d="M15 6l-6 6 6 6"/>,
 plus: <path d="M12 5v14M5 12h14"/>,
 check: <path d="M5 12.5l4.5 4.5L19 7.5"/>,
 eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></>,
 clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></>,
 code: <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5"/>,
 at: <><circle cx="12" cy="12" r="3.5"/><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7"/></>,
 chat: <path d="M4 5.5h16v10.5H9l-5 4z"/>,
};
export type BoardIconName = keyof typeof paths;
export function BoardIcon({name,className=''}:{name:BoardIconName,className?:string}) {
 return <svg className={`gw-icon board-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
