'use server';
import { redirect } from 'next/navigation';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { getI18n } from '@/lib/i18n-server';

// First run's one question (#9): the Owner works alone or with a team. The answer is stored on the Company, and the
// workspace opens on the Owner's one Conversation with Lead, or Lead's chat while the worker is still adding Lead.
export const chooseWorkMode=withActionLog('chooseWorkMode',async function chooseWorkMode(_state:string,form:FormData) {
 const {t}=await getI18n();
 const company=form.get('company'), slug=form.get('slug'), mode=form.get('mode');
 if(typeof company!=='string'||typeof slug!=='string'||!/^[a-z0-9-]+$/.test(slug)||(mode!=='alone'&&mode!=='team')) return t('firstRunFailed');
 const db=await supabase();
 if(!await actionAllowed(db,'chooseWorkMode',company)) return t('firstRunFailed');
 const {data:conversation,error}=await db.rpc('choose_work_mode',{c:company,mode});
 if(error) { logActionFailure('chooseWorkMode',error); return t('firstRunFailed'); }
 // The workspace's first page says it is ready, once (#169): the flag reaches the page it lands on.
 redirect(conversation?`/c/${slug}/conversations/${conversation}?first=${mode}`:`/c/${slug}/chat?first=${mode}`);
});
