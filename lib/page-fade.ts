// A page fades in when it opens (app/frame.tsx). Which page was last shown is kept here, not in a frame, because a frame
// can mount again on the page it already showed (app/shell.tsx wraps it while a first-run question is open) and that
// opens nothing. A new chat whose first message starts its Conversation moves to that Conversation's address, but it is
// the same page going on, as in the reference's send(), which draws the thread without setView: the chat names that
// address here before it moves, and the frame does not fade it. Any other new page clears it.
let shown:string|null=null;
let continued:string|null=null;
export const continuePage=(path:string)=>{ continued=path; };
// Whether a frame drawing `path` now opens a new page; it changes nothing, so a render may ask it.
export const opensPage=(path:string)=>path!==shown&&path!==continued;
// The frame has shown `path`: whether that opened a new page.
export const pageShown=(path:string)=>{ const opened=opensPage(path); shown=path; continued=null; return opened; };
