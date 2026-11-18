import 'server-only';
import { cache } from 'react';
import { supabase } from './supabase';
import { i18n } from './i18n.mjs';
export const getI18n = cache(async () => {
 const db=await supabase();
 // The person's row is asked for beside the sign-in check, by the id their session's token names, and kept only when
 // the check confirms that id (the database checks the same token): one round trip before every page, not two.
 const {data:{session}}=await db.auth.getSession();
 const named=tokenSubject(session?.access_token);
 const read=(id:string)=>db.from('people').select('language,theme').eq('id',id).single().then(result=>result);
 const early=named?read(named):null;
 const {data:{user}}=await db.auth.getUser();
 if(!user) return {...i18n(),theme:'device'};
 const {data:preference,error:preferenceError}=await (named===user.id&&early?early:read(user.id));
 if(preferenceError) throw new Error('Could not load account language');
 return {...i18n(preference.language==='ar'?'ar':'en'),theme:preference.theme??'device'};
});
// The `sub` of a JWT, unchecked: only a hint for which row to ask for early.
function tokenSubject(token?:string) {
 try { return token?String(JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).sub):null; } catch { return null; }
}
