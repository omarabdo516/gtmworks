'use client';
// A change an Agent proposed to its own settings, or Lead to another Agent's (#19, #484; design-reference: chgHTML,
// chgWhat, chgFromTo, waitLineHTML): who proposed it for whom, what would change, the value the Agent has now, the value
// after the Owner's OK and the reason. While it waits, an Owner sees "Waiting on you" and the answer (`answer`), which
// can edit the value before approving it; anyone else the wait line naming the Owners. Answered, it says who approved
// or declined and when, with the reason of a decline, and with the value the Agent proposed when the Owner changed it.
// A proposal of something that cannot be proposed says so and waits on nobody. The card follows the interface's
// direction; every value keeps its own.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useCardText } from '@/app/agent-card';
import { AgentFace } from '@/components/agent-face';
import { AppTile } from '@/components/app-tile';
import { markOf } from '@/lib/app-mark.mjs';
import { ShellIcon } from '@/components/shell-icon';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { useChangeWords, modelParts, type ModelChoice } from '@/app/change-words';
import { ReaderTime } from '@/app/agent-made';
import type { ChangeProposalView } from '@/lib/conversations';

// The field an Owner edits a proposal in, as lib/agent-changes.mjs reads it from the Agent's Engine profile.
export type ChangeField={kind:'model',options:ModelChoice[]}|{kind:'instructions',limit:number}|{kind:'switch'}
 |{kind:'setting',type:'string'|'number'|'boolean'|'select',choices:string[]|null,limits:{min?:number,max?:number,integer?:boolean}|null,default:unknown};
// What the card read of the Agent when it was drawn: `now` its value, `edit` the Owner's field. `loading` until it is in;
// null when there is nothing to read (an answered proposal, an Engine away).
// `approved`: an approval whose Engine write was never confirmed, being finished with the value it was writing.
export type ChangeRead={now:unknown,edit:ChangeField|null,approved?:unknown}|'loading'|null;

// The read and whether the Owner is editing, for the answer drawn inside the card.
const Shared=createContext<{read:ChangeRead,editing:boolean,setEditing:(editing:boolean)=>void}>({read:null,editing:false,setEditing:()=>{}});
export const useChangeShared=()=>useContext(Shared);

// The "Now" row and the editor come from the Agent's own Engine profile, read when a waiting card is drawn (#484).
function useChangeRead(company:string|undefined,change:ChangeProposalView,unread:boolean):ChangeRead {
 // A proposal whose approval is now being finished is read again: it no longer has a field to edit in.
 const key=company&&change.state==='waiting'&&!unread?`${company}:${change.id}:${change.approved===undefined?'waiting':'finishing'}`:null;
 const [got,setGot]=useState<{key:string,read:ChangeRead}|null>(null);
 useEffect(()=>{
  if(!key||!company) return;
  let live=true;
  fetch(`/api/agent-change?company=${encodeURIComponent(company)}&proposal=${change.id}`,{cache:'no-store'})
   .then(response=>response.ok?response.json():null).catch(()=>null)
   .then((body:{state?:string,now?:unknown,edit?:ChangeField|null,approved?:unknown}|null)=>{ if(live) setGot({key,read:body?.state==='found'?{now:body.now??null,edit:body.edit??null,...(body.approved!==undefined?{approved:body.approved}:{})}:null}); });
  return ()=>{ live=false; };
 },[key,company,change.id]);
 return !key?null:got?.key===key?got.read:'loading';
}

// A provider whose models carry another brand's mark: Google's models are Gemini (design-reference: MODELS' logos).
const providerMarks:Record<string,string>={google:'gemini'};

export function ChangeCard({change,company,owner=false,unread=false,answer}:{change:ChangeProposalView,company?:string,owner?:boolean,unread?:boolean,answer?:ReactNode}) {
 const {language}=useI18n(); const {c,cb}=useCardText();
 const read=useChangeRead(company,change,unread);
 const [editing,setEditing]=useState(false);
 const when=(at:string)=><ReaderTime at={at} orDay/>;
 const words=useChangeWords();
 const choices=read&&read!=='loading'&&read.edit?.kind==='model'?read.edit.options:[];
 const shown=(value:unknown)=>change.change==='model'?words.model(value):words.shown(value);
 const self=change.by.id===change.agent.id;
 // An approval the Owner edited names the value approved, with the one the Agent proposed beside it.
 const edited=change.state!=='waiting'&&change.state!=='refused'&&change.approved!==undefined;
 // A waiting approval being finished shows the value it is writing, as an edited approval does.
 const finishing=change.state!=='waiting'?undefined:change.approved!==undefined?change.approved:read&&read!=='loading'&&read.approved!==undefined?read.approved:undefined;
 const after=edited?change.approved:finishing!==undefined?finishing:change.value;
 // A proposal read in part names what would change and nothing of its value.
 const what=words.what({...change,value:after},unread);
 const owners=new Intl.ListFormat(localeFor(language),{type:'disjunction'}).format(change.state==='waiting'?change.owners:[]);
 const now=change.state==='waiting'&&read&&read!=='loading'&&read.now!==null&&read.now!==undefined?read.now:undefined;
 // A model's mark is its provider's logo, as Settings draws it (#424); every other change keeps the Agent's face.
 const model=change.change==='model'&&!unread?modelParts(after):null;
 const mark=model?<AppTile app={{key:providerMarks[model.provider]??model.provider,mark:markOf(model.provider)}} size="lg"/>:<AgentFace agent={change.agent.id} size={44}/>;
 const badge=change.state==='waiting'?(owner?<span className="badge badge--wait"><span className="dot dot--waiting" aria-hidden="true"/>{c('changeBadgeYou')}</span>
   :<span className="badge"><ShellIcon name="clock"/>{change.owners.length?cb('changeBadgeOwner',owners):c('changeBadgeAnyOwner')}</span>)
  :<span className="badge"><ShellIcon name={change.state==='approved'?'check':'x'}/>{c(change.state==='approved'?'changeBadgeApproved':change.state==='declined'?'changeBadgeDeclined':'changeBadgeRefused')}</span>;
 const outcome=change.state==='approved'?<div className="card__outcome"><ShellIcon name="check"/><span>{change.change==='model'
   ?cb(edited?'changeApprovedModelEdited':'changeApprovedModel',change.answeredBy,when(change.at),change.agent.name,shown(after))
   :cb(edited?'changeApprovedEdited':'changeApproved',change.answeredBy,when(change.at),change.agent.name)}</span></div>
  :change.state==='declined'?<div className="card__outcome pp-out"><ShellIcon name="x"/><span>{change.maybeApplied?cb('changeDeclinedMaybe',change.answeredBy,when(change.at),change.agent.name)
   :change.answer?cb('changeDeclinedReason',change.answeredBy,when(change.at),change.answer):cb('changeDeclined',change.answeredBy,when(change.at))}{change.maybeApplied&&change.answer?<> {cb('changeReason',change.answer)}</>:null}</span></div>
  :change.state==='refused'?<div className="card__outcome pp-out"><ShellIcon name="x"/><span>{c('changeRefused')}</span></div>
  :owner?answer:<div className="card__outcome"><ShellIcon name="clock"/><span>{change.owners.length?cb('changeWaiting',owners):c('changeWaitingAnyOwner')}</span></div>;
 const text=change.change==='instructions'?'chg-text':undefined;
 const head=<><div className="hcard__top">{badge}</div>
  <div className="card__head"><span aria-hidden="true">{mark}</span>
   <div className="card__titles"><span className="card__title">{cb('changeTitle',change.agent.name)}</span>
    <span className="card__sub">{self?cb('changeSelf',change.agent.name):cb('changeFor',change.by.name,change.agent.name)}</span></div></div></>;
 const editingNow=editing&&owner&&change.state==='waiting'&&change.approved===undefined;
 return <Shared.Provider value={{read,editing:editingNow,setEditing}}>
  <div id={`change-${change.id}`} tabIndex={-1} className={`ac-card chg-card${change.state==='waiting'?'':' is-resolved'}`} role="group"
   aria-label={editingNow?c('changeEditLabel',change.agent.name):c('changeLabel',change.agent.name)} data-change={change.state} data-editing={editingNow||undefined}>
   {head}
   {!editingNow&&<dl className="kv ac-kv pp-kv">
    <div className="kv__row"><dt>{c('changeRow')}</dt><dd>{what}{model&&<span className="pp-sub"><bdi>{model.providerName(choices)}</bdi></span>}</dd></div>
    {now!==undefined&&<div className="kv__row" data-row="now"><dt>{c('changeNow')}</dt><dd dir="auto" className={text}>{shown(now)}</dd></div>}
    {!unread&&<div className="kv__row" data-row="after"><dt>{c('changeAfter')}</dt><dd dir="auto" className={text}>{shown(after)}</dd></div>}
    {(edited||finishing!==undefined)&&change.change!=='instructions'&&<div className="kv__row" data-row="proposed"><dt>{c('changeProposed')}</dt><dd dir="auto">{shown(change.value)}</dd></div>}
    {!unread&&<div className="kv__row"><dt>{c('changeWhy')}</dt><dd dir="auto">{change.reason}</dd></div>}
   </dl>}
   {outcome}
  </div>
 </Shared.Provider>;
}
