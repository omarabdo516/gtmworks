'use client';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import channelEn from '@/lib/messages/channel.en.json';
import channelAr from '@/lib/messages/channel.ar.json';
import { ShellIcon } from '@/components/shell-icon';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { MessageBox, newId, postMessage, postMessageWithFiles } from '@/app/conversation-composer';
import { ConversationComposer, ConversationTurns, useConversationRecord } from '@/app/conversation-thread';
import { firstName, type ChannelRecord } from '@/lib/channels';
import { named } from '@/lib/bidi';
import type { ConversationRecord } from '@/lib/conversation-record';
import '@/app/channel.css';
import { sentIntoNewChat } from '@/lib/arrivals';

type Say=(key:string,...values:unknown[])=>string;
type SheetAgent={id:string,name:string,connection_id:string};
// What a Card's Chat tab shows its reader (#145): nothing, when the Card has no Agent they see; the way to start the
// Card's chat, when it has none yet; a lock, when it is another Member's (who, by first name, and nothing of it); or the
// reader's own Conversation, the record its page draws. A Card a channel put on the board (#151) shows that channel to
// the channel's members, as its page draws it, and the lock to a Member outside it: its name only, and the Card's log.
export type SheetChat=
 | {kind:'none'}
 | {kind:'empty',agent:SheetAgent}
 | {kind:'theirs',agent:SheetAgent,person:string}
 | {kind:'channel',record:ChannelRecord}
 | {kind:'channel-locked',name:string}
 | {kind:'own',record:ConversationRecord};
// design-reference: openSheet. Another Member's chat opens the Card on its Log, as do a Card with nothing to chat about
// and a channel the reader is not in.
export const opensOn=(chat:SheetChat)=>chat.kind==='own'||chat.kind==='empty'||chat.kind==='channel'?'chat':'log';

const panel={className:'transcript',id:'sheet-transcript',role:'tabpanel',['aria-labelledby']:'sh-tab-chat',tabIndex:-1} as const;

// The Chat tab's body and composer (design-reference: renderSheetBody, emptyChatHTML's sheet branch, send's sheet
// branch). A first message from the empty state starts the Card's chat in the database, which moves a Card under Ideas
// or Planned to In progress; the chat shows at once and the board behind is drawn again, so the head, the Log and the
// Card's column follow. It stays mounted through that redraw, so the chat keeps its place.
export function CardSheetChat({slug,company,card,chat,writer,shown,openLog}:{slug:string,company:string,card:number,chat:SheetChat,writer:boolean,shown:boolean,openLog:()=>void}) {
 const {t}=useI18n(); const router=useRouter();
 const [started,setStarted]=useState<ConversationRecord|null>(null); const [id]=useState(newId);
 const record=chat.kind==='own'?chat.record:started;
 if(record) return <SheetThread key={record.conversation.id} slug={slug} company={company} initial={record} writer={writer} shown={shown}/>;
 if(chat.kind==='channel') return <SheetChannel slug={slug} channel={chat.record} company={company} shown={shown}/>;
 if(chat.kind==='theirs') return <>
  <div {...panel}><div className="transcript__col"><div className="empty-chat priv-sheet">
   <span className="priv-sheet__ic" aria-hidden="true"><ShellIcon name="lock"/></span>
   <h2><Between person={chat.person} agent={chat.agent.name}/></h2>
   <p>{t('sheetChatShared')}</p>
   <button type="button" className="btn btn--secondary" onClick={openLog}><ShellIcon name="history"/><span>{t('sheetOpenLog')}</span></button>
  </div></div></div>
  <div className="composer-area"/>
 </>;
 if(chat.kind==='channel-locked') return <>
  <div {...panel}><div className="transcript__col"><div className="empty-chat priv-sheet">
   <span className="priv-sheet__ic" aria-hidden="true"><ShellIcon name="lock"/></span>
   <h2>#<bdi>{chat.name}</bdi></h2>
   <p>{t('sheetChatChannelShared')}</p>
   <button type="button" className="btn btn--secondary" onClick={openLog}><ShellIcon name="history"/><span>{t('sheetOpenLog')}</span></button>
  </div></div></div>
  <div className="composer-area"/>
 </>;
 if(chat.kind!=='empty') return null;
 const [before,after]=t('sheetChatEmptyLine','\u0000').split('\u0000');
 return <>
  <div {...panel}><div className="transcript__col"><div className="empty-chat empty-chat--sheet">
   <div className="empty-chat__faces"><span aria-hidden="true"><CompanyAgentFace agent={chat.agent} size={52}/></span></div>
   <h2>{t('sheetChatEmpty')}</h2>
   <p>{before}<bdi>{chat.agent.name}</bdi>{after}</p>
  </div></div></div>
  <div className="composer-area">{writer?<MessageBox placeholder={t('writeTo',chat.agent.name)} voice={{company,agent:chat.agent.id}} send={async(message,sendKey,files)=>{
   const failure=files.length?await postMessageWithFiles({company,conversation:id,card,message,sendKey},files):await postMessage({company,conversation:id,card,message,sendKey});
   if(failure==='sheetChatTaken') router.refresh();
   if(failure) return failure;
   // Its first message rises in, as one sent in an open Conversation does (#132).
   sentIntoNewChat(id);
   setStarted({conversation:{id,agent_id:chat.agent.id,agent_name:chat.agent.name,face:chat.agent.connection_id},messages:[{id:0,author:'person',author_name:'',body:message,created_at:new Date().toISOString()}],
    usage:null,pending:true,failed:false,working:null,canStop:false});
   router.refresh();
   return null;
  }}/>:<p className="ro-line" role="note"><ShellIcon name="eye"/><span>{t('viewOnly')}</span></p>}</div>
 </>;
}

function Between({person,agent}:{person:string,agent:string}) {
 const {t}=useI18n(); const parts=t('sheetChatBetween','\u00000\u0000','\u00001\u0000').split(/\u0000(\d)\u0000/);
 return <>{parts.map((part,index)=>index%2?<bdi key={index}>{part==='0'?person:agent}</bdi>:part)}</>;
}

// The reader's own chat on the Card, kept on its newest message while they are there.
function SheetThread({slug,company,initial,writer,shown}:{slug:string,company:string,initial:ConversationRecord,writer:boolean,shown:boolean}) { const {record,asked}=useConversationRecord({company,initial});
 const box=useRef<HTMLDivElement>(null); const stick=useRef(true);
 useLayoutEffect(()=>{ if(stick.current&&box.current) box.current.scrollTop=box.current.scrollHeight; },[record.messages.length,record.pending,shown]);
 return <>
  <div {...panel} ref={box} onScroll={event=>{ const view=event.currentTarget; stick.current=view.scrollHeight-view.scrollTop-view.clientHeight<80; }}>
   <div className="transcript__col"><ConversationTurns slug={slug} company={company} record={record} writer={writer} asked={asked}/></div>
  </div>
  <div className="composer-area"><ConversationComposer company={company} conversation={record.conversation} record={record} writer={writer} asked={asked} usage={false}/></div>
 </>;
}

// A Card a channel put on the board (#151): the channel under the Chat tab, for the Member reading it, with the channel's
// own send when they may write. It stays on the newest message while they are there and asks again while it is open, so
// an Agent's reply lands without a reload. A Viewer in the channel reads it with the view-only line. A message's files are
// the channel page's file links (#156), under its bubble, so an attachment-only message is no empty bubble.
function SheetChannel({slug,channel,company,shown}:{slug:string,channel:ChannelRecord,company:string,shown:boolean}) {
 const {t,language}=useI18n(); const own:Record<string,string>=language==='ar'?channelAr:channelEn;
 const c:Say=(key,...values)=>own[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 const [record,setRecord]=useState(channel); const box=useRef<HTMLDivElement>(null); const stick=useRef(true);
 const id=channel.channel.id; const name=channel.channel.kind==='team'?channel.channel.name:t('shellGeneralChannel');
 const read=async()=>{ try { const response=await fetch(`/api/channels?company=${company}&channel=${id}`,{cache:'no-store'}); if(response.ok) setRecord(await response.json() as ChannelRecord); } catch {} };
 useEffect(()=>{
  let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined;
  const poll=async()=>{ if(document.visibilityState==='visible') await read(); if(!stopped) timer=setTimeout(poll,2000); };
  timer=setTimeout(poll,shown?1500:6000);
  return ()=>{stopped=true;clearTimeout(timer);};
 },[id,company,shown]); // eslint-disable-line react-hooks/exhaustive-deps
 useLayoutEffect(()=>{ if(stick.current&&box.current) box.current.scrollTop=box.current.scrollHeight; },[record.messages.length,shown]);
 const {writer,messages}=record;
 return <>
  <div {...panel} ref={box} onScroll={event=>{ const view=event.currentTarget; stick.current=view.scrollHeight-view.scrollTop-view.clientHeight<80; }}>
   <div className="transcript__col"><ol className="turns" aria-label={c('channelMessages',name)}>
    {messages.map(message=>message.author==='note'
     ? <li key={message.id} className="note note--icon" data-kind={message.kind}><ShellIcon name={message.kind==='card'?'board':'team'} className="note__icon"/><span>{message.kind==='card'?c('channelCardNote',t('boardColProgress')):c('channelInviteNote',firstName(message.actor),message.name,name)}</span></li>
     : message.author==='handoff'
     ? <li key={message.id} className="handed" role="note" data-handover><span className="handed__faces"><CompanyAgentFace agent={{connection_id:message.from.face,name:message.from.name}} size={18}/><ShellIcon name={language==='ar'?'arrow':'arrowLtr'} className="handed__arrow"/><CompanyAgentFace agent={{connection_id:message.to.face,name:message.to.name}} size={18}/></span><span className="handed__t">{named(c,'channelHandedTo',message.to.name)}</span>{message.goal&&<span className="handed__d"><bdi>{message.goal}</bdi></span>}</li>
     : message.author==='agent'
     ? <li key={message.id} className="turn turn--agent msg" data-author="agent"><div className="sender"><span aria-hidden="true"><CompanyAgentFace agent={{connection_id:message.face,name:message.name}} size={20}/></span><bdi>{message.name}</bdi>{message.to&&<span className="sender__to">{c('channelSenderTo',message.to)}</span>}</div><div className="bubble bubble--agent" dir="auto">{message.body}</div></li>
     : <li key={message.id} className={`turn ${message.mine?'turn--user':'turn--peer'} msg`} data-author="person">
      {!message.mine&&<div className="sender"><span className="me__av lg-av" style={{'--av':'20px'} as CSSProperties} aria-hidden="true">{Array.from(message.name.trim())[0]||'?'}</span><bdi>{firstName(message.name)}</bdi></div>}
      {!!message.body.trim()&&<div className={`bubble ${message.mine?'bubble--user':'bubble--peer'}`} dir="auto">{message.body}</div>}
      {!!message.files.length&&<div className="msg-files">{message.files.map(file=><a key={file.id} className="file-chip" href={`/c/${slug}/files/channel/${file.id}`} target="_blank" rel="noreferrer" aria-label={t('attachOpen',file.name)}><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi></a>)}</div>}</li>)}
   </ol></div>
  </div>
  <div className="composer-area">{writer?<MessageBox label={c('channelMessageLabel')} placeholder={c('channelPlaceholder',name)} send={async(message,sendKey,files)=>{
    const fields={company,channel:id,message,sendKey};
    const failure=files.length?await postMessageWithFiles(fields,files,'/api/channels'):await postMessage(fields,'/api/channels');
    if(!failure) await read();
    return failure;
   }}/>:<p className="ro-line" role="note"><ShellIcon name="eye"/><span>{t('viewOnly')}</span></p>}</div>
 </>;
}
