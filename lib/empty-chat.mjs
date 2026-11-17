import { ownerNames } from './company-owners.mjs';
import { worksWith } from './agent-details.mjs';

/** @param {{data:any[]|null,error:unknown}} result */
const rows = ({ data, error }) => { if (error) throw error; return data || []; };

/**
 * Which empty chat an Agent shows its reader, as far as the database decides it (#170; design-reference: emptyChatHTML).
 * The active Owners are read only for a reader who is told whom a request goes to: asking for an Agent (`asks`, #17), or
 * the main Agent's empty chat in a team. An Agent other than the main one is new to a reader with no Conversation with it
 * (row-level security shows only the reader's own); whether an Owner is the only one who sees it needs the active
 * Members and its access rows. Every read the database refuses fails the chat rather than draw it wrong.
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 * @param {{company:string,agent:string,me:string,main:boolean,fresh:boolean,alone:boolean,owner:boolean,asks:boolean}} facts
 */
export async function emptyChatFacts(db, { company, agent, me, main, fresh, alone, owner, asks }) {
 const owners = !owner && (asks || (main && !fresh && !alone)) ? await ownerNames(db, company) : [];
 if (fresh) return { state: 'fresh', owners };
 if (main) return { state: 'main', reader: alone ? 'alone' : owner ? 'owner' : 'member', owners };
 const sole = !alone && owner;
 const [written, members, access] = await Promise.all([
  db.from('conversations').select('id', { count: 'exact', head: true }).eq('company_id', company).eq('agent_id', agent).eq('person_id', me)
   .then(/** @param {{count:number|null,error:unknown}} result */ ({ count, error }) => { if (error) throw error; return count ?? 0; }),
  sole ? db.from('members').select('person_id,role').eq('company_id', company).is('removed_at', null).then(rows) : [],
  sole ? db.from('member_agent_access').select('person_id').eq('company_id', company).eq('agent_id', agent).then(rows)
   .then(/** @param {{person_id:string}[]} list */ list => list.map(row => row.person_id)) : [],
 ]);
 if (written) return { state: 'known', owners };
 return { state: 'new', works: worksWith({ alone, me, members, access }), owners };
}
