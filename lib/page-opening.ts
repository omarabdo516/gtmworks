// The page the person is opening right now (a link they activated, or a control that opens a page, such as closing the
// Card window back to its board, #678), until it has landed. Prefetches never count. Read by the account menu, which
// stays open on that page when it lands (app/account-menu-view.tsx).
let opening: string | null = null;
/** The page whose navigation the person started and that has not landed yet, if any. */
export const pageBeingOpened = () => opening;
/** Marks `href` as the page the person is opening; null when it landed or the opener stopped waiting for it. */
export const openingPage = (href: string | null) => { opening = href == null ? null : new URL(href, location.href).pathname; };
