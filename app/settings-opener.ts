// Where the settings overlay was opened from (sessionStorage), so its close button returns there. Kept apart from the
// overlay's own client code so the account menu, on every page, carries only these few lines.
export const openedFromKey='gw-settings-from';
export function rememberOpener() { try { sessionStorage.setItem(openedFromKey,`${location.pathname}${location.search}`); } catch { /* storage off: closing goes to the chat */ } }
export function openedFrom() { try { return sessionStorage.getItem(openedFromKey); } catch { return null; } }
