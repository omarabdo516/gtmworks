import 'server-only';
import { cache } from 'react';
import { supabase } from './supabase';
import { i18n } from './i18n.mjs';
export const getI18n = cache(async () => {
 const db=await supabase();
 const {data:{user}}=await db.auth.getUser();
 if(!user) return {...i18n(),theme:'device'};
 const {data:preference,error:preferenceError}=await db.from('people').select('language,theme').eq('id',user.id).single();
 if(preferenceError) throw new Error('Could not load account language');
 return {...i18n(preference.language==='ar'?'ar':'en'),theme:preference.theme??'device'};
});
