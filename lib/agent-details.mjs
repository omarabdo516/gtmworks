/**
 * @template {{id:number, created_at:string}} T @param {T[]} rows @param {string} since @param {number} [n]
 */
export function latestActivity(rows, since, n = 3) {
 return rows.filter(row => Date.parse(row.created_at) >= Date.parse(since))
  .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id).slice(0, n);
}

/** @param {string} agent */
export const agentLogFilter = agent => `and(actor_kind.eq.agent,actor_id.eq.${agent}),agent_id.eq.${agent}`;

// The panel's tabs; `?tab=` names the one shown first. Memory opens with the Agent's own notes (#350).
const detailsTabs = ['activity', 'tasks', 'files', 'memory', 'log'];
/** @param {unknown} value */
export const pickTab = value => detailsTabs.find(tab => tab === value) ?? 'activity';

// A file's size as the reference writes it (86 KB, 12.4 MB), in Latin digits in both languages.
/** @param {number} bytes */
export function fileSize(bytes) {
 const [value, unit] = bytes >= 1048576 ? [bytes / 1048576, 'MB'] : bytes >= 1024 ? [bytes / 1024, 'KB'] : [bytes, 'B'];
 return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: unit === 'MB' ? 1 : 0 }).format(value)} ${unit}`;
}

// The Agent's files (#21), newest first: those of the reader's own
// Conversations with it, named for the Conversation as the sidebar names it, and those it handed over in a channel the
// reader is a Member of (#715), named for the channel as the sidebar names it. Each opens through its own address.
/**
 * @param {{slug:string,
 *  conversationFiles:{id:number,name:string,size:number,created_at:string,conversation_id:string,agent_name:string}[], titles:Map<string,string>,
 *  channelFiles:{id:number,name:string,size:number,created_at:string,channel:string}[]}} files
 */
export function agentFiles({ slug, conversationFiles, titles, channelFiles }) {
 return [
  ...conversationFiles.map(file => ({ key: `conversation-${file.id}`, name: file.name, size: file.size, at: file.created_at, href: `/c/${slug}/files/conversation/${file.id}`, source: titles.get(file.conversation_id) || file.agent_name })),
  ...channelFiles.map(file => ({ key: `channel-${file.id}`, name: file.name, size: file.size, at: file.created_at, href: `/c/${slug}/files/channel/${file.id}`, source: `#${file.channel}` })),
 ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * Whom a new Agent's empty chat says it works with (#170; design-reference: newAgentEmptyHTML's kind): "you" in a
 * Company worked alone, or when the reader is the only active Member who sees it. Every active Owner sees every Agent, so
 * that is only ever a sole Owner whose Agent no other active Member has been given.
 * @param {{alone:boolean, me:string, members:{person_id:string, role:string}[], access:string[]}} facts the active
 * Members and the people with an access row for the Agent
 * @returns {'you'|'team'}
 */
export function worksWith({ alone, me, members, access }) {
 if (alone) return 'you';
 if (members.find(member => member.person_id === me)?.role !== 'owner') return 'team';
 return members.some(member => member.person_id !== me && (member.role === 'owner' || access.includes(member.person_id))) ? 'team' : 'you';
}
