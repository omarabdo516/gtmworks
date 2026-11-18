'use client';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { MessageBox, newId, postMessage, postMessageWithFiles, type MessageBoxHandle } from '@/app/conversation-composer';
import { AgentEmptyChat, type EmptyChat } from '@/app/agent-empty-chat';
import { PrivateLine } from '@/app/private-line';
import { AgentDetails, HeadPill, useDetailsPanel, type DetailsAgent } from '@/app/agent-details';
import { OpenedMark } from '@/app/agent-made';
import Link from '@/lib/link';
import type { ReadyRole } from '@/lib/ready-roles';
import type { AgentDetailsView } from '@/app/agent-details-server';

const ReadyMade=lazy(()=>import('@/app/ready-made'));

// An Agent the picker can open, with everything its empty chat and its details draw: read on the server for every Agent
// this reader sees while the opened chat shows the picker (#171).
export type ShownAgent={agent:DetailsAgent,empty:EmptyChat,details:AgentDetailsView|null};

// An Agent's empty chat (design-reference: emptyChatHTML): what `empty` says the Agent shows its reader
// (app/agent-empty-chat.tsx), and the composer, with the Agent's details beside it; a suggestion fills the composer. A
// Viewer reads one quiet line where the composer would be.
// `agents` is every Agent this reader sees, the main one first, each with its own empty chat and details: picking its chip
// turns this page into that Agent's empty chat with no navigation, so the title, the details and the composer's
// placeholder follow the pick and the chip keeps the focus (design-reference: pick-new-agent). A message then starts the
// Conversation with the picked Agent. `newAgent` (design-reference: openLeadForAgent): the composer is focused, its
// example is an Agent to ask for, and one hint line above it says Lead makes the Agent right away. `isNew`: an Agent Lead
// made at this person's request, opened by them for the first time (#13). The hint line also links to the ready-made
// gallery (#14), which `gallery` opens over the chat (?new=ready); leaving it gives the focus back to the composer.
// `askOf`: the Owners a Manager or a Contributor asks for an Agent instead (#17). In a team, a line at the top says the
// chat is between this person and the Agent only (#25).
export default function AgentChat({slug,company,agent,details,writer,team=false,empty={state:'known',example:null},newAgent=false,askOf=null,isNew=false,gallery=null,agents=[]}:{slug:string,company:string,agent:DetailsAgent|null,details:AgentDetailsView|null,writer:boolean,team?:boolean,empty?:EmptyChat,newAgent?:boolean,askOf?:string[]|null,isNew?:boolean,gallery?:{company:string,alone:boolean,roles:ReadyRole[]}|null,agents?:ShownAgent[]}) {
 const {t,language}=useI18n(); const router=useRouter();
 // One Conversation per Agent, made the first time it is needed: coming back to an Agent whose send failed keeps the
 // Conversation and its send key, so a retry is the same send and the Engine starts nothing twice (#355 review).
 const conversations=useRef(new Map<string,string>());
 const conversationOf=(id:string)=>{ const known=conversations.current.get(id); if(known) return known; const made=newId(); conversations.current.set(id,made); return made; };
 const [conversation,setConversation]=useState(newId);
 // The Agent this page opened with keeps the first id it was given, so coming back to it after a failed send reuses it.
 const openedAgent=agent?.id;
 useEffect(()=>{ if(openedAgent&&!conversations.current.has(openedAgent)) conversations.current.set(openedAgent,conversation); },[openedAgent]); // eslint-disable-line react-hooks/exhaustive-deps -- seed once, with the id the page opened on
 // A send that may have stored something keeps the picker closed until it answers: its navigation must not be overtaken.
 const [sending,setSending]=useState(false);
 const panel=useDetailsPanel();
 const composer=useRef<HTMLDivElement>(null); const transcript=useRef<HTMLDivElement>(null); const picking=!!gallery; const wasPicking=useRef(picking);
 const box=useRef<MessageBoxHandle>(null);
 useEffect(()=>{ if(wasPicking.current&&!picking) composer.current?.querySelector('textarea')?.focus(); wasPicking.current=picking; },[picking]);
 // The Agent on screen: the one this page opened, or the one picked from its chips. The pick draws the new state at once,
 // with no navigation, and the focus follows it.
 const [picked,setPicked]=useState<string|null>(null);
 const shown=agents.find(choice=>choice.agent.id===picked)??{agent,empty,details};
 const current=shown.agent;
 const chip=useRef<HTMLButtonElement|null>(null); const pickingAgent=useRef(false);
 const pick=(id:string)=>{ if(id===current?.id||sending) return; pickingAgent.current=true; setPicked(id); setConversation(conversationOf(id)); };
 // The pressed chip keeps the focus where the state the pick shows still draws it. Where it does not (the main Agent's
 // chat, a new Agent's), the focus moves into the empty chat that took its place, never back to the page.
 useEffect(()=>{ if(!pickingAgent.current) return; pickingAgent.current=false;
  if(chip.current) chip.current.focus(); else transcript.current?.querySelector<HTMLElement>('.empty-chat h2')?.focus();
 },[picked]);
 const opening=newAgent&&!picked;
 return <div className="convo">
  <div className="chat">
   <HeadPill panel={panel} agent={current?.name} face={current&&<span aria-hidden="true"><CompanyAgentFace agent={current} size={24}/></span>} title={t('newChat')}/>
   <div className="transcript" ref={transcript}><div className="transcript__col">
    {current&&team&&<PrivateLine agent={current.name}/>}
    {current?<AgentEmptyChat agent={current} empty={shown.empty} askOf={askOf} suggest={writer?text=>box.current?.insert(text):undefined} picker={agents.length>1?{agents:agents.map(choice=>({id:choice.agent.id,connection_id:choice.agent.connection_id,name:choice.agent.name})),onPick:pick,disabled:sending,chipRef:element=>{chip.current=element}}:undefined}/>:<div className="empty-chat"><p role="note">{t('conversationNoAgent')}</p></div>}
   </div></div>
   <div className="composer-area" ref={composer}>{current&&writer&&opening&&<div className="new-hint" role="note"><ShellIcon name="userPlus" className="new-hint__ic"/><p className="new-hint__t">{!askOf?t('newAgentHint',current.name):askOf.length?t('newAgentHintMember',current.name,new Intl.ListFormat(localeFor(language),{type:'conjunction'}).format(askOf)):t('newAgentHintMemberAnyOwner',current.name)}</p>
    {!askOf&&<Link className="link-btn new-hint__alt" href={`/c/${slug}/chat?new=ready`}>{t('newAgentReadyMade')}</Link>}</div>}
    {current&&gallery&&<Suspense fallback={null}><ReadyMade slug={slug} company={company} agent={current.id} companyName={gallery.company} alone={gallery.alone} lead={current.name} roles={gallery.roles}/></Suspense>}
    {current&&(writer?<MessageBox key={`${opening}`} ref={box} focus={opening&&!gallery} placeholder={opening?t('newAgentExample'):t('writeTo',current.name)} voice={{company,agent:current.id}} send={async(message,sendKey,files)=>{
    setSending(true);
    const failure=files.length?await postMessageWithFiles({company,conversation,agent:current.id,message,sendKey},files):await postMessage({company,conversation,agent:current.id,message,sendKey});
    if(failure) { setSending(false); return failure; }
    // The page moves to the Conversation just started; until it has, the box stays busy, so neither a suggestion nor a
    // second Enter can start another one.
    router.push(`/c/${slug}/conversations/${conversation}`);
    return new Promise<never>(()=>{});
   }}/>:<p className="ro-line" role="note"><ShellIcon name="eye"/><span>{current.main?t('viewOnlyLead'):t('viewOnly')}</span></p>)}</div>
  </div>
  {current&&shown.details&&<AgentDetails key={current.id} panel={panel} agent={current} details={shown.details} slug={slug}/>}
  {agent&&isNew&&<OpenedMark company={company} agent={agent.id}/>}
 </div>;
}
