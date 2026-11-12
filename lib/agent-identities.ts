import { cache } from 'react';
import { supabase } from '@/lib/supabase';
import type { AgentIdentity } from './agent-identities-client';

export const agentIdentities=cache(async()=>{
 const db=await supabase();
 const {data}=await db.rpc('agent_identities');
 return (data||[]) as AgentIdentity[];
});
