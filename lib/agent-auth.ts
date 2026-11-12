import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { hashKey, sameHash } from './agent-crypto.mjs';
import { supabaseConfig } from './supabase-config';

type Identity = {key_id:string,company_id:string,person_id:string,slug:string,key_hash:string,kind:string,card_id:number|null};
// A company key has no expiry. A run key reaches `run_card` only, and its internal token says so.
export type AgentSession = Identity & {run_card:number|null,limited:false,db:SupabaseClient};

// Alongside first-run setup, this request-path module holds the service role key. It does
// not read or write cards. A member-scoped JWT is used for all work queries.
export async function authenticateAgent(key: string): Promise<AgentSession | (Identity & {limited:true}) | {denied:true} | null> {
 const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
 const jwtSecret = process.env.SUPABASE_JWT_SECRET;
 if (!serviceKey || !jwtSecret) throw new Error('Agent authentication is not configured');
 const admin = createClient(supabaseConfig.url, serviceKey, {auth:{persistSession:false}});
 const hash = hashKey(key);
 const { data, error } = await admin.rpc('lookup_agent_key', {hash});
 if (error) throw new Error('Agent lookup failed');
 const identity = data?.[0] as Identity | undefined;
 if (!identity) {
  // A live key whose agent holds no active company grant is refused as not found, not as a bad key.
  const denied = await admin.rpc('agent_key_denied', {hash});
  if (denied.error) throw new Error('Agent grant lookup failed');
  return denied.data ? {denied:true as const} : null;
 }
 // The prefix says which kind of key was presented; a key of the other kind is as good as unknown.
 const kind = key.startsWith('gtmw_run_') ? 'run' : 'agent';
 if (!sameHash(hash, identity.key_hash) || identity.kind !== kind) return null;
 const limit = await admin.rpc('agent_rate_limit', {k:identity.key_id});
 if (limit.error) throw new Error('Rate limit unavailable');
 if (limit.data) return {...identity, limited:true as const};
 const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
 const now = Math.floor(Date.now()/1000);
 const payload = `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:identity.person_id,role:'authenticated',aud:'authenticated',iat:now,exp:now+300,...(kind==='run' ? {run_card:Number(identity.card_id)} : {})})}`;
 const token = `${payload}.${createHmac('sha256',jwtSecret).update(payload).digest('base64url')}`;
 const db = createClient(supabaseConfig.url,supabaseConfig.anonKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
 return {...identity, run_card:kind==='run' ? Number(identity.card_id) : null, limited:false as const, db};
}
