'use client';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { MessageBox, newId, postMessage, type MessageBoxHandle } from '@/app/conversation-composer';
import { AgentEmptyChat, type EmptyChat } from '@/app/agent-empty-chat';
import { PrivateLine } from '@/app/private-line';
import { AgentDetails, HeadPill, useDetailsPanel, type DetailsAgent } from '@/app/agent-details';
import { OpenedMark } from '@/app/agent-made';
import Link from '@/lib/link';
import type { ReadyRole } from '@/lib/ready-roles';
import type { AgentDetailsView } from '@/app/agent-details-server';

const ReadyMade=lazy(()=>import('@/app/ready-made'));

// An Agent's empty chat (design-reference: emptyChatHTML): what `empty` says the Agent shows its reader
// (app/agent-empty-chat.tsx), and the composer, with the Agent's details beside it; a suggestion fills the composer. A
// Viewer reads one quiet line where the composer would be.
// `newAgent` (design-reference: openLeadForAgent): the composer is focused, its example is an Agent to ask for, and one
// hint line above it says Lead makes the Agent right away. `isNew`: an Agent Lead made at this person's request, opened
// by them for the first time (#13). The hint line also links to the ready-made gallery (#14), which `gallery` opens over
// the chat (?new=ready); leaving it gives the focus back to the composer. `askOf`: the Owners a Manager or a Contributor
// asks for an Agent instead (#17). In a team, a line at the top says the chat is between this person and the Agent only
// (#25).
export default function AgentChat({slug,company,agent,details,writer,team=false,empty={state:'known'},newAgent=false,askOf=null,isNew=false,gallery=null}:{slug:string,company:string,agent:DetailsAgent|null,details:AgentDetailsView|null,writer:boolean,team?:boolean,empty?:EmptyChat,newAgent?:boolean,askOf?:string[]|null,isNew?:boolean,gallery?:{company:string,alone:boolean,roles:ReadyRole[]}|null}) {
 const {t,language}=useI18n(); const router=useRouter(); const [conversation]=useState(newId); const panel=useDetailsPanel();
 const composer=useRef<HTMLDivElement>(null); const picking=!!gallery; const wasPicking=useRef(picking);
 const box=useRef<MessageBoxHandle>(null);
 useEffect(()=>{ if(wasPicking.current&&!picking) composer.current?.querySelector('textarea')?.focus(); wasPicking.current=picking; },[picking]);
 return <div className="convo">
  <div className="chat">
   <HeadPill panel={panel} agent={agent?.name} face={agent&&<span aria-hidden="true"><CompanyAgentFace agent={agent} size={24}/></span>} title={t('newChat')}/>
   <div className="transcript"><div className="transcript__col">
    {agent&&team&&<PrivateLine agent={agent.name}/>}
    {agent?<AgentEmptyChat agent={agent} empty={empty} askOf={askOf} suggest={writer?text=>box.current?.insert(text):undefined}/>:<div className="empty-chat"><p role="note">{t('conversationNoAgent')}</p></div>}
   </div></div>
   <div className="composer-area" ref={composer}>{agent&&writer&&newAgent&&<div className="new-hint" role="note"><ShellIcon name="userPlus" className="new-hint__ic"/><p className="new-hint__t">{!askOf?t('newAgentHint',agent.name):askOf.length?t('newAgentHintMember',agent.name,new Intl.ListFormat(localeFor(language),{type:'conjunction'}).format(askOf)):t('newAgentHintMemberAnyOwner',agent.name)}</p>
    {!askOf&&<Link className="link-btn new-hint__alt" href={`/c/${slug}/chat?new=ready`}>{t('newAgentReadyMade')}</Link>}</div>}
    {agent&&gallery&&<Suspense fallback={null}><ReadyMade slug={slug} company={company} agent={agent.id} companyName={gallery.company} alone={gallery.alone} lead={agent.name} roles={gallery.roles}/></Suspense>}
    {agent&&(writer?<MessageBox key={`${newAgent}`} ref={box} focus={newAgent&&!gallery} placeholder={newAgent?t('newAgentExample'):t('writeTo',agent.name)} send={async(message,sendKey)=>{
    const failure=await postMessage({company,conversation,agent:agent.id,message,sendKey});
    if(failure) return failure;
    // The page moves to the Conversation just started; until it has, the box stays busy, so neither a suggestion nor a
    // second Enter can start another one.
    router.push(`/c/${slug}/conversations/${conversation}`);
    return new Promise<never>(()=>{});
   }}/>:<p className="ro-line" role="note"><ShellIcon name="eye"/><span>{agent.main?t('viewOnlyLead'):t('viewOnly')}</span></p>)}</div>
  </div>
  {agent&&details&&<AgentDetails panel={panel} agent={agent} details={details} settingsHref={`/c/${slug}/agents`}/>}
  {agent&&isNew&&<OpenedMark company={company} agent={agent.id}/>}
 </div>;
}
