import { personOf, sessionOf } from './cookie-session.mjs';
import { crossSiteWrite } from './app-origin.mjs';

// The person behind a WebSocket gtmworks's own web server takes (ADR 0029): the Screen's stream (lib/screen-stream.mjs)
// and the board's (lib/board-stream.mjs). A page on another site may not open one: its Origin names another host than
// the one asked (403). The person is read from the session cookie the browser sent (lib/cookie-session.mjs): its access
// token, which must still have a minute to run when the socket opens, is used as it is and never refreshed here, since a
// refresh would spend the browser's own refresh token. One with no such token is signed out (4401), and the page
// refreshes its session with an ordinary request before it opens another socket. `db` is their own database session for
// the socket's life.
export const signedOut=4401;

/**
 * The signed-in person who asks to open a socket, or why they may not.
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<{refused:number}|{db:any,person:string,expiresAt:number}>}
 */
export async function socketPerson(request) {
 const headers=new Headers(Object.entries(request.headers).flatMap(([name,value])=>typeof value==='string'?[[name,value]]:[]));
 if(crossSiteWrite(headers)) return {refused:403};
 const signedIn=await sessionOf(request.headers.cookie??'');
 if(!signedIn) return {refused:signedOut};
 const signer=await personOf(signedIn.token);
 if(!signer) return {refused:signedOut};
 return {db:signer.db,person:signer.person,expiresAt:signedIn.expiresAt};
}
