// The sidebar's order: the main Agent (is_default, named Lead) first, then the others as the database ordered them.
export const orderAgents = agents => [...agents.filter(agent => agent.is_default), ...agents.filter(agent => !agent.is_default)];

const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// Recent chats grouped by the reader's local day, as the reference's sidebar shows them: Today, Yesterday, Earlier.
export function groupRecents(conversations, now = new Date()) {
 const today = startOfDay(now), yesterday = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
 const dayOf = value => { const start = startOfDay(new Date(value)); return start >= today ? 'today' : start >= yesterday ? 'yesterday' : 'earlier'; };
 const newest = [...conversations].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
 return ['today', 'yesterday', 'earlier'].map(day => ({ day, items: newest.filter(item => dayOf(item.created_at) === day) })).filter(group => group.items.length);
}
