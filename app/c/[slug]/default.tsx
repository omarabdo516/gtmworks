// Settings at their own address (#612): the Company's frame, drawn by its layout (app/c/[slug]/layout.tsx) and inert
// under the overlay the `settings` slot draws over it (app/c/[slug]/@settings/settings), with an empty page. It is the
// page slot's default, not a page: a page here would be fetched again at its Settings address on every refresh, and
// that address now opens the overlay over a page, not this frame. Signed out, it draws nothing; the slot sends the
// person to sign in.
export default function SettingsFrame() {
 return <main className="content"/>;
}
