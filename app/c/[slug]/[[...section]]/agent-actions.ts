'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { getI18n } from '@/lib/i18n-server';
import { newKey, encryptSecret } from '@/lib/agent-crypto.mjs';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
export const createAgentKey=withActionLog('createAgentKey',async function createAgentKey(_state:{key?:string,error?:string}, form:FormData):Promise<{key?:string,error?:string}> { const {t}=await getI18n();
 const db=await supabase();
 const {key,hash}=newKey('agent');
 const {error}=await db.from('agent_keys').insert({company_id:String(form.get('company')),person_id:String(form.get('person')),key_hash:hash});
 if(error) { logActionFailure('createAgentKey',error,{form}); return {error:t('couldNotCreateTheKeyCheckTheMembers')}; }
 revalidatePath(`/c/${String(form.get('slug'))}/settings/agents`);
 return {key};
});
export const revokeAgentKey=withActionLog('revokeAgentKey',async function revokeAgentKey(form:FormData) {
 const {t}=await getI18n(); const db=await supabase(); const path=`/c/${String(form.get('slug'))}/settings/agents`;
 // A key that was not revoked must say so: an update that fails, or matches nothing (not permitted), is shown as a message.
 const {data,error}=await db.from('agent_keys').update({revoked_at:new Date().toISOString()}).eq('id',String(form.get('id'))).eq('company_id',String(form.get('company'))).select('id');
 revalidatePath(path);
 if(error || !data?.length) logActionFailure('revokeAgentKey',error || {message:'no key matched'},{form});
 if(error || !data?.length) redirect(`${path}?message=${encodeURIComponent(t('couldNotSaveTheChangeCheckPermissionsAnd'))}`);
});

export const saveWebhook=withActionLog('saveWebhook',async function saveWebhook(_state:{message?:string},form:FormData):Promise<{message?:string}> { const {t}=await getI18n();
 const db=await supabase(); const company=String(form.get('company')); const slug=String(form.get('slug'));
 try { const url=new URL(String(form.get('url'))); if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw new Error('url');
 const secret=String(form.get('secret')); if (!secret) throw new Error('secret');
 const {error}=await db.from('agent_webhooks').upsert({company_id:company,url:url.toString(),secret_encrypted:encryptSecret(secret,process.env.WEBHOOK_ENCRYPTION_KEY),updated_at:new Date().toISOString()});
 if(error) throw error; revalidatePath(`/c/${slug}/settings/agents`); return {message:t('notificationSettingsSaved')};
 } catch(error) { logActionFailure('saveWebhook',error,{form}); return {message:t('couldNotSaveSettingsCheckTheURLSecret')}; }
});

export const changeAgentAccess=withActionLog('changeAgentAccess',async function changeAgentAccess(form:FormData) { const {t}=await getI18n();
 const db=await supabase(); const path=`/c/${String(form.get('slug'))}/agents`;
 const {error}=await db.rpc(form.get('intent')==='grant'?'grant_agent_access':'revoke_agent_access',{c:String(form.get('company')),a:String(form.get('agent'))});
 revalidatePath(path);
 if(error) logActionFailure('changeAgentAccess',error,{form});
 redirect(error?`${path}?message=${encodeURIComponent(t('couldNotChangeThisAgentsAccess'))}`:path);
});
