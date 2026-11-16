// "N" starts a new chat (design-reference: the N key), for a person who can write. By the key's place, not its letter,
// so it also works on an Arabic keyboard (where that key types «ى»). Shift is let through, as in the reference. It waits
// while the person types in a field or while a layer is open: the card sheet (<dialog open>), the settings overlay, first
// run and every Paperclip dialog. The phone drawer (#sidebar) takes role=dialog while it covers the page, and the
// reference lets N work there.
export const startsNewChat=(event:KeyboardEvent)=>event.code==='KeyN'&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.defaultPrevented&&!event.isComposing
 &&!(event.target instanceof Element&&event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
 &&!document.querySelector('dialog[open], [role="dialog"]:not(#sidebar), [role="alertdialog"]');

// The page a new chat is opening, whose composer takes the focus once it is drawn.
let pendingComposerFocus:string|null=null;
export const askComposerFocus=(path:string)=>{ pendingComposerFocus=path; };
export const takeComposerFocus=(path:string)=>{ if(pendingComposerFocus!==path) return false; pendingComposerFocus=null; return true; };
