// The sidebar's order: the main Agent (is_default, named Lead) first, then the others as the database ordered them.
export const orderAgents = agents => [...agents.filter(agent => agent.is_default), ...agents.filter(agent => !agent.is_default)];

// The company's real Agents for the sidebar's grid, the main Agent first.
export async function companyAgents(db, company) {
 const { data } = await db.from('hermes_agents').select('id,connection_id,name,speciality,is_default').eq('company_id', company).order('name');
 return orderAgents(data || []);
}

// The approvals entry beside Marketing board is named even when nothing waits, so the Inbox stays reachable.
export const waitingLabel = count => count ? ['thingsWaitingOnYou', count] : ['nothingWaitingOnYou'];

// The account menu's theme choices; "device" follows the system's light or dark setting.
export const themeChoices = ['light', 'dark', 'device'];

const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// Recent chats grouped by the reader's local day, as the reference's sidebar shows them: Today, Yesterday, Earlier.
export function groupRecents(conversations, now = new Date()) {
 const today = startOfDay(now), yesterday = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
 const dayOf = value => { const start = startOfDay(new Date(value)); return start >= today ? 'today' : start >= yesterday ? 'yesterday' : 'earlier'; };
 const newest = [...conversations].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
 return ['today', 'yesterday', 'earlier'].map(day => ({ day, items: newest.filter(item => dayOf(item.created_at) === day) })).filter(group => group.items.length);
}
