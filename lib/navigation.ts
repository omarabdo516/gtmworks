// The sidebar's four entries, as the approved reference lists them: Chats, Marketing board, Numbers, Activity log.
// Numbers and Activity log open their own pages (#35, #11); the board entry's count opens the Inbox.
export const shellNav = [['chat','chats','chat'], ['work/board','marketingBoard','board'], ['numbers','numbers','chart'], ['log','activityLog','history']] as const;
// Every company section and its title. Sections without a sidebar entry still open inside the shell.
export const primaryNav =[['search','search'], ['home','home'], ['approvals','inbox']] as const;
export const navGroups = [
 {label:'workGroup',items:[['work/board','work'],['projects','projects'],['recurring','routines'],['campaigns','campaigns'],['library','library'],['publishing','publishing']]},
 {label:'results',items:[['sales','salesAndCustomers'],['performance','performance'],['strategy','strategyAndLearning']]},
 {label:'team',items:[['agents','teamAgents'],['skills','skills'],['connections','connections'],['history','activityLog']]},
] as const;
export const nav = [...primaryNav,...navGroups.flatMap<readonly [string,string]>(group=>group.items),['settings','settings']] as const;
export const sections: Record<string,string> = Object.fromEntries([...nav, ['work/board','marketingBoard'], ['approvals','marketingBoard'], ['work/new','newCard'], ['work/calendar','work'], ['work/list','work'], ['settings/members','settings'], ['settings/work','workSettings'], ['settings/agents','settings'], ['usage','usage']]);
export const placeholders: Record<string,string> = {search:'searchIsNotAvailableYet',recurring:'noRoutinesYet',connections:'noConnectionsYet',history:'noActivityLogYet'};
export function safeNext(value: string | null) { return value && /^\/c\/[^/]+\//.test(value) && !value.startsWith('//') && !value.includes('\\') ? value : '/'; }
