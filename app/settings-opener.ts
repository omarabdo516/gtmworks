// Where the settings overlay was opened from (sessionStorage), so its close button returns there, and the element to
// focus on return. Kept apart from the overlay's own client code so the account menu, on every page, carries only these
// few lines.
const openedFromKey='gw-settings-from', returnKey='gw-return-focus';
type Opener={from:string,focus:string|null};
export function rememberOpener(focus?:string) { try { sessionStorage.setItem(openedFromKey,JSON.stringify({from:`${location.pathname}${location.search}`,focus:focus??null})); sessionStorage.removeItem(returnKey); } catch { /* storage off: closing goes to the chat */ } }
function opener():Opener|null {
 let text:string|null; try { text=sessionStorage.getItem(openedFromKey); } catch { return null; }
 if(text==null) return null;
 // An address stored before the focus was kept is the plain string.
 try { const value=JSON.parse(text); if(typeof value?.from==='string') return {from:value.from,focus:typeof value.focus==='string'?value.focus:null}; } catch { /* the plain string */ }
 return {from:text,focus:null};
}
// The element a page focuses once it is drawn: written right before leaving the overlay, so a link followed out of it
// elsewhere never takes the focus away from where it lands.
export function returnFocusTo(id:string|null) { try { if(id) sessionStorage.setItem(returnKey,id); else sessionStorage.removeItem(returnKey); } catch { /* storage off: the focus stays where the page puts it */ } }
// Closing the overlay: the page it was opened from, its opener focused there.
export function leaveOverlay() { const from=opener(); returnFocusTo(from?.focus??null); return from?.from??null; }
// True once, and only for the element the stored id names, so each page consumes only its own.
export function takeReturnFocus(id:string) { try { if(sessionStorage.getItem(returnKey)!==id) return false; sessionStorage.removeItem(returnKey); return true; } catch { return false; } }
