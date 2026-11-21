// A change an Agent proposed for its own settings, or Lead for another Agent's (#19), while it waits for the Owner, as
// Settings shows it (#178; design-reference: chgPendingFor, chgVisible, sovAgentHTML's note, sovAgentsHTML's row and
// sovNavHTML's count). Which proposals a reader gets is the database's to decide (agent_change_proposals_read): every
// Owner reads all of them, and anyone else only one made in their own Conversation while they see both Agents, so a
// reader who may not open that Conversation, or does not see the Agent, gets none. A proposal whose approval is being
// written still waits (state 'applying'), as the chat and "Waiting on you" draw it.

const waitingChangeColumns = 'id,agent_id,conversation_id,asked_by,change,setting,value,created_at,by:hermes_agents!proposed_by(name)';

/**
 * The waiting proposals this reader may see, oldest first, as the reference finds the first one of an Agent.
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 * @param {string} company
 * @returns {Promise<import('./agent-change-waiting.d.mts').WaitingChange[]>}
 */
export async function readWaitingChanges(db, company) {
 const { data, error } = await db.from('agent_change_proposals').select(waitingChangeColumns).eq('company_id', company)
  .in('state', ['waiting', 'applying']).order('created_at').order('id');
 if (error) throw error;
 return /** @type {any[]} */ (data || []).map(row => ({ id: row.id, agent: row.agent_id, conversation: row.conversation_id, askedBy: row.asked_by,
  change: row.change, setting: row.setting, value: row.value, by: row.by?.name || '' }));
}

/** How many proposals wait for this Owner: the number on Settings' "Agents" (the Owner's alone). */
export async function countWaitingChanges(db, company) {
 const { count, error } = await db.from('agent_change_proposals').select('id', { count: 'exact', head: true }).eq('company_id', company).in('state', ['waiting', 'applying']);
 if (error) throw error;
 return count || 0;
}

/** The proposal an Agent's page and row show: its oldest waiting one. */
export const waitingChangeFor = (changes, agent) => changes.find(change => change.agent === agent) || null;

/**
 * Where "Open the proposal" goes: the Conversation that holds its card when the reader may open it (only its own person
 * may), and for an Owner otherwise their item in "Waiting on you".
 */
export function waitingChangeHref(slug, change, reader) {
 if (change.askedBy === reader.person) return `/c/${slug}/conversations/${change.conversation}#change-${change.id}`;
 return reader.owner ? `/c/${slug}/approvals#change-${change.id}` : null;
}
