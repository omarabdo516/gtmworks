import { morningTitle } from './good-morning-title.mjs';

// A Conversation's title, wherever it is named (the sidebar, its own page's head, All conversations): a Conversation the
// morning opened (#183) by its day, in the reader's language; any other by the first line of its first message, else
// that message's first file when it carries images alone (#155), else its Agent's name. The database names it by the
// same rule for All conversations' list and title search (public.conversation_title, 20270415999993), which hands its
// title over as `body`.
/** @param {{morningDay?:string|null,body?:string|null,file?:string|null,agent:string}} chat @param {(key:string,...values:unknown[])=>string} t @param {string} language */
export function conversationTitle({morningDay,body,file,agent},t,language) {
 if(morningDay) return morningTitle(t,language,morningDay);
 return body?.split('\n')[0]||file||agent;
}
