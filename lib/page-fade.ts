// A page fades in when it opens (app/frame.tsx). A new chat whose first message starts its Conversation moves to that
// Conversation's address, but it is the same page going on, as in the reference's send(), which draws the thread without
// setView: the chat names that address here before it moves, and the frame does not fade it. Any other new page clears it.
let continued:string|null=null;
export const continuePage=(path:string)=>{ continued=path; };
export const continuesPage=(path:string)=>continued===path;
export const takeContinuedPage=(path:string)=>{ const was=continued; continued=null; return was===path; };
