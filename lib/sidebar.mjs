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

// The sidebar's chat search: a title matches when it holds what was typed, ignoring case and the space around it.
export const matchChats = (chats, query) => { const wanted = query.trim().toLowerCase(); return wanted ? chats.filter(chat => chat.title.toLowerCase().includes(wanted)) : chats; };

// The sections the reference has no place for, reached from the account menu's "More sections" group:
// [path under /c/<slug>/, message key, icon].
export const moreSections = [['home','home','home'], ['projects','projects','folder'], ['skills','skills','bulb'], ['approvals','approvals','review'], ['usage','usage','cpu'], ['settings/members','members','team'], ['settings/work','workSettings','gear'], ['settings/agents','agentKeys','shield'], ['agents','agents','team']];
