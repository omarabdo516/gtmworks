---
status: accepted
date: 2026-11-25
---

# gtmworks carries the Screen's live stream on its own web server

Issue #713 (spec #710). A Member who takes control of an Agent's Screen works it live with their own mouse and keyboard, and anyone watching sees it move. The pinned Engine serves that stream as raw RFB over a WebSocket, `/api/display/ws`, on its management listener, which is never public (ADR 0011). gtmworks had no WebSocket of its own: Next.js route handlers answer HTTP only.

## Context

- The Engine's viewer is one connection to `/api/ws` (`tui_gateway/methods_display.py`): `display.observe` mints a viewer id for that connection and a single-use ticket of 30 seconds for `/api/display/ws`; `display.lease.acquire` and `display.lease.release` take only an id the same connection minted. The lease is last writer wins, and the stream's bridge drops keyboard and pointer input from anyone but the lease's holder (`hermes_cli/web_routers/display.py`, `tools/bot_desktop/rfb_filter.py`).
- The Engine keeps a lease when a stream merely drops (a closed laptop lid), so the person can come back to it. gtmworks's spec says losing the connection gives control back.
- The install's gateway (nginx) serves gtmworks's one address; the release image runs Next's standalone build; the browser tests run the same build through `scripts/web.sh`.
- Next.js has a supported custom-server API (`next({dir})`, `getRequestHandler`), and leaves an upgrade to a path it has no route for alone.

## Decision

- **gtmworks's web server is its own** (`scripts/web-server.mjs`): it serves every page and route through Next's custom-server API, and takes the one upgrade at `/api/display/ws` itself. The image, the install's compose file, `npm start` and `scripts/web.sh` (dev, the browser tests) all run it. In the image it reads the standalone build's resolved config from `.next/required-server-files.json`, as Next's generated `server.js` embeds it.
- **The browser's socket is gtmworks's, not the Engine's** (`lib/screen-stream.mjs`). gtmworks checks the person from their session cookie (a Member the Agent is shown to; a page on another site is refused by its Origin), opens a viewer on the Engine contract (`screenViewer`, ADR 0009) for the Agent's own profile, and keeps it open while the browser's socket is open. Binary frames are the RFB stream both ways; text frames are gtmworks's own small JSON messages: who controls the Screen, a stream opening or closing, a take refused, a give-back done. The Engine's address, key, ticket and viewer id never reach the browser.
- **Control is gtmworks's to give back.** A take is asked of the database first (`check_screen_control`: a Member who is not a Viewer and sees the Agent), refused while another viewer holds, and logged; "Done", the socket closing (the view closed, the page left) and a heartbeat ping left unanswered (the connection lost) each give it back and log it. A socket that closes frees the Screen here even when the Engine fails the release; control no open socket here holds (a release that failed, or this server stopped while a person held it) is given back by force when the next person opens the Screen or takes control.
- **Access is asked again, not only at connect.** Each take asks the database again, and every minute an open socket asks whether the person is still a Member shown the Agent on its profile and may still take control: one no longer shown it is closed (4404), and one made a Viewer while holding control gives it back and keeps watching. A database that does not answer changes nothing until the next check.
- **No one else sees what is typed.** While a person holds control, gtmworks streams the Screen to them only; everyone else watching is told who has control, and their stream opens again when it is given back.
- **The gateway passes the upgrade on** for that one path (`scripts/install-nginx.conf`), repeating Host and the stripping of every address a client claims, since a location that sets its own headers inherits none. In production the web server ends an upgrade on any other path.
- **The browser draws the stream with noVNC** (`@novnc/novnc`, MPL-2.0, the client the Engine's own desktop app uses), fed from gtmworks's socket through a small channel.

## Considered options

- **The gateway proxies the browser straight to the Engine's `/api/display/ws`.** Rejected: the management listener would be reachable from outside (ADR 0011), and the ticket, viewer id and lease would live in the browser, where nothing gives control back when a connection drops.
- **A separate relay service behind the gateway.** Rejected: one more process and image entry to run, and the browser tests, which reach the app without the gateway, would need it too.
- **Intercept upgrades inside Next.js by patching its HTTP server from `instrumentation.ts`.** Rejected: it depends on Next's internals and start-up order.
- **A refreshing picture only, with input sent as HTTP requests.** Rejected: a person signing in needs to see what they type as they type it.

## Consequences

- The person is read from the access token in the session cookie, which must have a minute left when the socket opens; it is never refreshed on the socket, since a refresh would spend the browser's own refresh token. A socket therefore lives at most as long as that token: once it runs out the next check closes it (4401), the page refreshes the session and opens another, and control held then goes back. A take's log row needs that token to be still valid; a give-back logged after it expired is reported to the server log and not written.
- Who holds control is kept in the web server's memory. The install runs one web server; a second one would need a shared place for it.
- The release's compose file runs `node scripts/web-server.mjs` instead of `node server.js`; a release and its compose file come together, so an update and a rollback each run the command of their own release.
- `ws` moves from a development dependency to a dependency.
