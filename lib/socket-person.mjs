import { createClient } from '@supabase/supabase-js';
import { combineChunks, parseCookieHeader, stringFromBase64URL } from '@supabase/ssr';
import { supabaseSettings } from './supabase-settings.mjs';
import { crossSiteWrite } from './app-origin.mjs';

// The person behind a WebSocket gtmworks's own web server takes (ADR 0029): the Screen's stream (lib/screen-stream.mjs)
// and the board's (lib/board-stream.mjs). A page on another site may not open one: its Origin names another host than
// the one asked (403). The person is read from the session cookie the browser sent: its access token, which must still
// have a minute to run when the socket opens, is used as it is and never refreshed here, since a refresh would spend the
// browser's own refresh token. One with no such token is signed out (4401), and the page refreshes its session with an
// ordinary request before it opens another socket. `db` is their own database session for the socket's life.
export const signedOut=4401;

/** @param {string} header */
async function sessionOf(header) {
 const settings=supabaseSettings();
 const key=settings.cookieOptions?.name??`sb-${new URL(settings.url).hostname.split('.')[0]}-auth-token`;
 const jar=new Map(parseCookieHeader(header??'').map(({name,value})=>[name,value??'']));
 const raw=await combineChunks(key,name=>jar.get(name));
 if(!raw) return null;
 try {
  const found=JSON.parse(raw.startsWith('base64-')?stringFromBase64URL(raw.slice(7)):raw);
  const expiresAt=Number(found?.expires_at)*1000;
  if(typeof found?.access_token!=='string'||!(expiresAt>Date.now()+60000)) return null;
  return {token:found.access_token,expiresAt};
 } catch { return null; }
}

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
 const settings=supabaseSettings();
 const db=createClient(settings.url,settings.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${signedIn.token}`}}});
 const {data:{user}={user:null},error}=await db.auth.getUser(signedIn.token);
 if(error||!user) return {refused:signedOut};
 return {db,person:user.id,expiresAt:signedIn.expiresAt};
}
