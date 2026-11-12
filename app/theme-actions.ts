'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { getI18n } from '@/lib/i18n-server';
export const saveTheme=withActionLog('saveTheme',async function saveTheme(_state:string,form:FormData) {
 const {t}=await getI18n();
 const theme=form.get('theme');
 if(theme!=='light'&&theme!=='dark'&&theme!=='device') return t('couldNotSaveTheChangeCheckPermissionsAnd');
 const db=await supabase();
 const {error}=await db.rpc('set_theme',{chosen_theme:theme});
 if(error) { logActionFailure('saveTheme',error); return t('couldNotSaveTheChangeCheckPermissionsAnd'); }
 revalidatePath('/','layout');
 return '';
});
