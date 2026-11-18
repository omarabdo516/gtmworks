'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';

const refusals=['channelNameMissing','channelNameTooLong','channelNameTaken'] as const;
type ChannelRefusal=typeof refusals[number]|'channelFailed';
type MemberRole='owner'|'manager'|'contributor'|'viewer';
type ChannelChoices={people:{person:string|null,name:string,role:MemberRole,invitation:string|null,email:string|null}[],agents:{id:string,connection_id:string,name:string,speciality:string,main:boolean}[]};

// A team channel (#24), made by an Owner or a Manager with the Members, the Agents and the invited people chosen (#207).
// create_channel checks the Role again, names the channel, refuses a name in use, and returns the same channel for the
// same request key.
export const createChannel=withActionLog('createChannel',async function createChannel(company:string,request:{key:string,name:string,people:string[],agents:string[],invitees:string[]}):Promise<{channel:string}|{refused:ChannelRefusal}> {
 const db=await supabase();
 if(!await actionAllowed(db,'createChannel',company)) return {refused:'channelFailed'};
 const {data,error}=await db.rpc('create_channel_inviting',{c:company,request_key:request.key,channel_name:request.name,people:request.people,agents:request.agents,invitees:request.invitees});
 if(error&&(refusals as readonly string[]).includes(error.message)) return {refused:error.message as ChannelRefusal};
 if(error||typeof data!=='string') { logActionFailure('createChannel',{code:error?.code,message:'create_channel refused'}); return {refused:'channelFailed'}; }
 return {channel:data};
});

// One Member, one invited person or one Agent in or out of a team channel. set_channel_person, set_channel_invitee and
// set_channel_agent check the Role again, refuse the general channel and taking yourself out, and change nothing when
// repeated.
export const changeChannel=withActionLog('changeChannel',async function changeChannel(company:string,channel:string,change:{person:string,present:boolean}|{invitation:string,present:boolean}|{agent:string,present:boolean}):Promise<''|'channelFailed'> {
 const db=await supabase();
 if(!await actionAllowed(db,'changeChannel',company)) return 'channelFailed';
 const {error}='person' in change?await db.rpc('set_channel_person',{ch:channel,person:change.person,present:change.present})
  :'invitation' in change?await db.rpc('set_channel_invitee',{ch:channel,invitation:change.invitation,present:change.present})
  :await db.rpc('set_channel_agent',{ch:channel,agent:change.agent,present:change.present});
 if(error) { logActionFailure('changeChannel',{code:error.code,message:'a channel change was refused'}); return 'channelFailed'; }
 return '';
});

// Who can be put in a channel: every Member who is a person and every invited person who has not joined (the general
// channel holds exactly them, #207), and the Agents the caller sees (the Owner every one).
export const channelChoices=withActionLog('channelChoices',async function channelChoices(company:string):Promise<ChannelChoices|null> {
 const db=await supabase();
 if(!await actionAllowed(db,'channelChoices',company)) return null;
 const {data:general}=await db.from('channels').select('id').eq('company_id',company).eq('kind','general').maybeSingle();
 if(!general) return null;
 const {data:people}=await db.rpc('channel_members',{ch:general.id});
 const {data:agents}=await db.from('hermes_agents').select('id,connection_id,name,speciality,is_default').eq('company_id',company).order('is_default',{ascending:false}).order('name');
 return {
  people:(people||[]) as ChannelChoices['people'],
  agents:((agents||[]) as {id:string,connection_id:string,name:string,speciality:string,is_default:boolean}[]).map(agent=>({id:agent.id,connection_id:agent.connection_id,name:agent.name,speciality:agent.speciality,main:agent.is_default})),
 };
});
