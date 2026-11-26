import { createClient } from '@supabase/supabase-js';
import { combineChunks, parseCookieHeader, stringFromBase64URL } from '@supabase/ssr';
import { supabaseSettings } from './supabase-settings.mjs';

// The person a socket's upgrade comes from (ADR 0029): the session cookie the app's own sign-in sets (@supabase/ssr,
// possibly in chunks), read on the web server where no page runs. Its access token is used as it is and never refreshed
// here, since a refresh would spend the browser's own refresh token, so it must still have a minute to run.
/** @param {string} header @returns {Promise<{token:string,expiresAt:number}|null>} */
export async function sessionOf(header) {
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

/** A database client that acts as the person the token names, and that person, or null when the token is not theirs.
 * @param {string} token */
export async function personOf(token) {
 const settings=supabaseSettings();
 const db=createClient(settings.url,settings.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`}}});
 const {data:{user}={user:null},error}=await db.auth.getUser(token);
 return error||!user?null:{db,person:user.id};
}
