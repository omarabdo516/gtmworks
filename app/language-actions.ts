'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { getI18n } from '@/lib/i18n-server';
export const saveLanguage=withActionLog('saveLanguage',async function saveLanguage(_state:string,form:FormData) {
 const {t}=await getI18n();
 const language=form.get('language');
 if(language!=='en'&&language!=='ar') return t('couldNotSaveTheChangeCheckPermissionsAnd');
 const db=await supabase();
 const {error}=await db.rpc('set_language',{chosen_language:language});
 if(error) { logActionFailure('saveLanguage',error); return t('couldNotSaveTheChangeCheckPermissionsAnd'); }
 revalidatePath('/','layout');
 return '';
});
