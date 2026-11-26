import type { ReactNode } from 'react';

// Every Company page, with Settings as a layer over it (#612). The `settings` slot holds the overlay: opened from a page
// of the Company it is drawn over that page, which stays as it was (its scroll, its drafts) and is out of reach while
// the dialog is open (data-workspace, app/settings-overlay-frame.tsx); opened at its own address it is drawn over the
// Company's frame. Closing returns to the page underneath.
export default function CompanyLayout({children,settings}:{children:ReactNode,settings:ReactNode}) {
 return <><div className="contents" data-workspace>{children}</div>{settings}</>;
}
