import { boardColumns, columnOf, progressOf } from './board-columns.mjs';

const states = [['waiting', facts => facts.waitingMine], ['working', facts => facts.running], ['idle', () => true]];
/** @param {{waitingMine:boolean, running:boolean}} facts */
export const agentStatus = facts => states.find(([, holds]) => holds(facts))[0];

/**
 * @param {{id:number, title:string, stage_id:number}[]} cards
 * @param {{id:number, name:string, board_column?:string|null}[]} stages
 * @param {{card_id:number, title:string, done:boolean}[]} checklist
 * @param {{kind:string, title:string, body:string, card_id:number|null}[]} waitingItems
 */
export function agentTasks(cards, stages, checklist, waitingItems) {
 return cards.map(card => {
  const column = columnOf(card, stages);
  const stage = stages.find(item => item.id === card.stage_id)?.name || '';
  const wait = waitingItems.find(item => item.card_id === card.id);
  const progress = column === 'progress' ? progressOf(card, checklist) : null;
  const line = wait?.kind === 'approval' && wait.body ? { key: 'boardWaitingYourOk', args: [wait.body] }
   : wait && wait.kind !== 'approval' ? { text: wait.title }
   : progress ? { text: `${progress.next || stage} · ${progress.pct}%` }
   : { text: stage };
  return { id: card.id, title: card.title, column, line, waiting: column === 'waiting' };
 }).sort((a, b) => boardColumns.indexOf(a.column) - boardColumns.indexOf(b.column));
}

/**
 * @template {{id:number, created_at:string}} T @param {T[]} rows @param {string} since @param {number} [n]
 */
export function latestActivity(rows, since, n = 3) {
 return rows.filter(row => Date.parse(row.created_at) >= Date.parse(since))
  .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id).slice(0, n);
}

/** @param {string} agent */
export const agentLogFilter = agent => `and(actor_kind.eq.agent,actor_id.eq.${agent}),agent_id.eq.${agent}`;

// The panel's tabs that open (Memory is drawn but waits, #21); `?tab=` names the one shown first.
const detailsTabs = ['activity', 'tasks', 'files', 'log'];
/** @param {unknown} value */
export const pickTab = value => detailsTabs.find(tab => tab === value) ?? 'activity';

// A file's size as the reference writes it (86 KB, 12.4 MB), in Latin digits in both languages.
/** @param {number} bytes */
export function fileSize(bytes) {
 const [value, unit] = bytes >= 1048576 ? [bytes / 1048576, 'MB'] : bytes >= 1024 ? [bytes / 1024, 'KB'] : [bytes, 'B'];
 return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: unit === 'MB' ? 1 : 0 }).format(value)} ${unit}`;
}

// The Agent's files (#21), newest first: those of its Cards, named for the Card, and those of the reader's own
// Conversations with it, named for the Conversation as the sidebar names it. Each opens through its own address.
/**
 * @param {{slug:string, cards:{id:number,title:string}[], cardFiles:{id:number,name:string,size:number,created_at:string,card_id:number}[],
 *  conversationFiles:{id:number,name:string,size:number,created_at:string,conversation_id:string,agent_name:string}[], titles:Map<string,string>}} files
 */
export function agentFiles({ slug, cards, cardFiles, conversationFiles, titles }) {
 return [
  ...cardFiles.map(file => ({ key: `card-${file.id}`, name: file.name, size: file.size, at: file.created_at, href: `/c/${slug}/files/${file.id}`, source: cards.find(card => card.id === file.card_id)?.title || '' })),
  ...conversationFiles.map(file => ({ key: `conversation-${file.id}`, name: file.name, size: file.size, at: file.created_at, href: `/c/${slug}/files/conversation/${file.id}`, source: titles.get(file.conversation_id) || file.agent_name })),
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
