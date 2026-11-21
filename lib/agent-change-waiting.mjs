// A change an Agent proposed for its own settings, or Lead for another Agent's (#19), while it waits for the Owner, as
// Settings shows it (#178; design-reference: chgPendingFor, chgVisible, sovAgentHTML's note, sovAgentsHTML's row and
// sovNavHTML's count). Which proposals a reader gets is the database's to decide (agent_change_proposals_read): every
// Owner reads all of them, and anyone else only one made in their own Conversation while they see both Agents, so a
// reader who may not open that Conversation, or does not see the Agent, gets none. A proposal whose approval is being
// written still waits (state 'applying'), as the chat and "Waiting on you" draw it. Each of the three places reads only
// what it draws: the number is counted, the row marks are the Agents with one, and the note is that Agent's oldest one,
// so none of them is cut short by the API's row limit.

const waiting = ['waiting', 'applying'];
// The API's own limit on the rows of one read (supabase/config.toml, api.max_rows).
const page = 1000;

/**
 * The oldest waiting proposal for one Agent this reader may see, as the reference finds the first one of an Agent.
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 * @returns {Promise<import('./agent-change-waiting.d.mts').WaitingChange|null>}
 */
export async function readWaitingChange(db, company, agent) {
 const { data, error } = await db.from('agent_change_proposals').select('id,agent_id,conversation_id,asked_by,change,setting,value,by:hermes_agents!proposed_by(name)')
  .eq('company_id', company).eq('agent_id', agent).in('state', waiting).order('created_at').order('id').limit(1).maybeSingle();
 if (error) throw error;
 if (!data) return null;
 const row = /** @type {any} */ (data);
 return { id: row.id, agent: row.agent_id, conversation: row.conversation_id, askedBy: row.asked_by, change: row.change, setting: row.setting, value: row.value, by: row.by?.name || '' };
}

/** The Agents with a waiting proposal this reader may see: the rows of the Agents list marked "Proposal waiting". */
export async function readWaitingAgents(db, company) {
 const agents = new Set();
 for (let from = 0; ; from += page) {
  const { data, error } = await db.from('agent_change_proposals').select('agent_id').eq('company_id', company).in('state', waiting).order('id').range(from, from + page - 1);
  if (error) throw error;
  for (const row of data || []) agents.add(row.agent_id);
  if (!data || data.length < page) return agents;
 }
}

/** How many proposals wait for this Owner: the number on Settings' "Agents" (the Owner's alone). */
export async function countWaitingChanges(db, company) {
 const { count, error } = await db.from('agent_change_proposals').select('id', { count: 'exact', head: true }).eq('company_id', company).in('state', waiting);
 if (error) throw error;
 return count || 0;
}

/**
 * Where "Open the proposal" goes: the Conversation that holds its card when the reader may open it (only its own person
 * may), and for an Owner otherwise their item in "Waiting on you".
 */
export function waitingChangeHref(slug, change, reader) {
 if (change.askedBy === reader.person) return `/c/${slug}/conversations/${change.conversation}#change-${change.id}`;
 return reader.owner ? `/c/${slug}/approvals#change-${change.id}` : null;
}
