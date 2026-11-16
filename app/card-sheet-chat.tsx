'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { MessageBox, newId, postMessage } from '@/app/conversation-composer';
import { ConversationComposer, ConversationTurns, useConversationRecord } from '@/app/conversation-thread';
import type { ConversationRecord } from '@/lib/conversation-record';

type SheetAgent={id:string,name:string,connection_id:string};
// What a Card's Chat tab shows its reader (#145): nothing, when the Card has no Agent they see; the way to start the
// Card's chat, when it has none yet; a lock, when it is another Member's (who, by first name, and nothing of it); or the
// reader's own Conversation, the record its page draws.
export type SheetChat=
 | {kind:'none'}
 | {kind:'empty',agent:SheetAgent}
 | {kind:'theirs',agent:SheetAgent,person:string}
 | {kind:'own',record:ConversationRecord};
// design-reference: openSheet. Another Member's chat opens the Card on its Log, as does a Card with nothing to chat about.
export const opensOn=(chat:SheetChat)=>chat.kind==='own'||chat.kind==='empty'?'chat':'log';

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
 if(chat.kind==='theirs') return <>
  <div {...panel}><div className="transcript__col"><div className="empty-chat priv-sheet">
   <span className="priv-sheet__ic" aria-hidden="true"><ShellIcon name="lock"/></span>
   <h2><Between person={chat.person} agent={chat.agent.name}/></h2>
   <p>{t('sheetChatShared')}</p>
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
  <div className="composer-area">{writer?<MessageBox placeholder={t('writeTo',chat.agent.name)} send={async(message,sendKey)=>{
   const failure=await postMessage({company,conversation:id,card,message,sendKey});
   if(failure==='sheetChatTaken') router.refresh();
   if(failure) return failure;
   setStarted({conversation:{id,agent_id:chat.agent.id,agent_name:chat.agent.name,face:chat.agent.connection_id},messages:[{id:0,author:'person',author_name:'',body:message,created_at:new Date().toISOString()}],
    usage:{input:0,output:0,unknown:0},pending:true,failed:false,working:null,canStop:false});
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
function SheetThread({slug,company,initial,writer,shown}:{slug:string,company:string,initial:ConversationRecord,writer:boolean,shown:boolean}) {
 const {record,asked}=useConversationRecord({company,initial});
 const box=useRef<HTMLDivElement>(null); const stick=useRef(true);
 useLayoutEffect(()=>{ if(stick.current&&box.current) box.current.scrollTop=box.current.scrollHeight; },[record.messages.length,record.pending,shown]);
 return <>
  <div {...panel} ref={box} onScroll={event=>{ const view=event.currentTarget; stick.current=view.scrollHeight-view.scrollTop-view.clientHeight<80; }}>
   <div className="transcript__col"><ConversationTurns slug={slug} record={record}/></div>
  </div>
  <div className="composer-area"><ConversationComposer company={company} record={record} writer={writer} asked={asked} usage={false}/></div>
 </>;
}
