'use client';
import { useEffect, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import type { AgentAbout as AboutRead } from '@/lib/agent-about.mjs';
import type { AgentVoice as VoiceRead } from '@/lib/agent-voice.mjs';
import type { MorningRead } from '@/lib/agent-morning.mjs';
import type { StandingPermission } from '@/lib/standing-permissions.mjs';
import type { AgentSkillRow } from './settings-agent-form';
import { StandingPermissions } from './standing-permissions';
import { AgentAbout, AgentInstructions, AgentInstructionsReadOnly, AgentSkills, AgentVoice, AgentEffort, AgentMorning, AgentVoiceSpeed, AgentModel } from './settings-lazy';
import { partUrl, useSettingsPart, foundRead as found, firstReading as reading, PartReading, type PartRead } from './settings-part-read';

// The parts of an Agent's page in Settings that its own Engine profile keeps (#161, #162, #166, #176, #179, #180, #182,
// #29), each read by the browser on its own after the page is drawn from what gtmworks stores (#898, ADR 0030): the page
// never waits for the Engine, and a slow part holds up no other. A part still on its first read says so; one whose read
// fails keeps its last good read, and with none is drawn as an Engine that could not be read always was: no editor, and
// the read-only value's empty mark. Who may change each part is as it was: only the read moved.
type How={state:string,own:boolean,instructions:string,sectionChars:number,limit:number}|null;
type Skills={state:string,own:boolean,skills:AgentSkillRow[]|null}|null;
type Permissions={state:string,permissions:StandingPermission[]|null};
export type AgentModelRead={models:{agents:{model:string|null,choice:string|null,own:boolean,choosable:boolean,effort:string|null,options:{provider:string,providerName:string,model:string}[]}[]}|null};
const useAgentPart=<T,>(company:string,agent:string,part:string,asked:number,good:(data:T)=>boolean=found as (data:T)=>boolean):PartRead<T>=>useSettingsPart<T>(partUrl(company,part,{agent}),asked,good);
// One empty list for every draw: StandingPermissions treats a new list as the server's list drawn again.
const none:StandingPermission[]=[];

function Line({children}:{children:ReactNode}) { return <div className="panel-card"><p className="panel-empty">{children}</p></div>; }

// About is the Agent's profile description (#161): editable by the Owner and Managers on its own profile, once read.
export function AboutPart({company,agent,name,canManage,asked}:{company:string,agent:string,name:string,canManage:boolean,asked:number}) {
 const read=useAgentPart<AboutRead|null>(company,agent,'about',asked);
 if(reading(read)) return <PartReading/>;
 const about=read.data;
 return canManage&&about?.state==='found'&&about.own?<AgentAbout agent={agent} name={name} description={about.description??''}/>
  :<div className="panel-card"><p className="ro-text" id="set-about">{about?.description||'—'}</p></div>;
}

// How it works (#176): the Owner edits it on the Agent's own profile, every other Role reads it with its line breaks.
export function HowPart({company,agent,name,owner,asked}:{company:string,agent:string,name:string,owner:boolean,asked:number}) {
 const {t}=useI18n();
 const read=useAgentPart<How>(company,agent,'how',asked);
 if(reading(read)) return <PartReading/>;
 const how=read.data;
 return owner&&how?.state==='found'&&how.own?<AgentInstructions agent={agent} name={name} instructions={how.instructions??''} sectionChars={how.sectionChars??0} limit={how.limit??20000}/>
  :<AgentInstructionsReadOnly instructions={how?.state==='found'?how.instructions:''} empty={how?.state==='found'?t('settingsHowEmpty'):'—'}/>;
}

// Good morning (#182), the main Agent's one row of How it works. "Change the time" on the morning's card (#183) opens the
// page with `focus`: once the row is read, Time takes the focus, or the switch while the message is off and Time cannot.
export function MorningPart({company,agent,canManage,focus,asked}:{company:string,agent:string,canManage:boolean,focus:boolean,asked:number}) {
 const read=useAgentPart<MorningRead|{state:'failed'}>(company,agent,'morning',asked);
 const morning=read.data?.state==='found'?read.data as Extract<MorningRead,{state:'found'}>:null;
 const target=focus&&canManage&&morning?(morning.routine?.on?'set-ck-time':'set-ck-on'):null;
 useEffect(()=>{
  if(!target) return;
  // A person who has moved into a field meanwhile keeps it.
  const active=document.activeElement;
  if(active&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
  const element=document.getElementById(target); element?.focus(); element?.scrollIntoView({block:'center'});
 },[target]);
 if(reading(read)) return <PartReading/>;
 return <AgentMorning agent={agent} editable={canManage&&!!morning} morning={morning?{made:!!morning.routine,on:morning.routine?.on===true,time:morning.routine?.time??null,expr:morning.routine?.schedule.expr??null,display:morning.routine?.schedule.display??null,timezone:morning.routine?.timezone??null,quietYesterday:morning.quietYesterday}:null}/>;
}

// Thinking: the Agent's own model (#29), then its thinking level (#179), the Owner's alone on its own profile once read.
export function ThinkingPart({company,agent,name,owner,asked}:{company:string,agent:string,name:string,owner:boolean,asked:number}) {
 const {t}=useI18n();
 const read=useAgentPart<AgentModelRead>(company,agent,'agentModel',asked,data=>data?.models!=null);
 if(reading(read)) return <PartReading/>;
 const mine=read.data?.models?.agents[0];
 if(!mine) return <Line>{t('settingsModelsUnread')}</Line>;
 return <>
  <AgentModel key={agent} company={company} agent={agent} name={name} model={mine.model} choice={mine.choice} options={mine.options} choosable={mine.choosable} owner={owner} readAt={read.readAt}/>
  <AgentEffort agent={agent} effort={mine.effort} editable={owner&&mine.own===true&&mine.effort!==null}/>
 </>;
}

// The Agent's voice (#162): editable on its own profile by the Owner and Managers, read-only for everyone else. Its speed
// is in Advanced and shares this read.
export function VoicePart({company,agent,personName,canManage,asked}:{company:string,agent:string,personName:string,canManage:boolean,asked:number}) {
 const {t}=useI18n();
 const read=useAgentPart<VoiceRead|null>(company,agent,'voice',asked);
 if(reading(read)) return <PartReading/>;
 const voice=read.data;
 return canManage&&voice?.state==='found'&&voice.own?<AgentVoice company={company} agent={agent} personName={personName} voice={voice}/>
  :<ul className="panel-card"><li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsVoice')}</span>
   <span className="panel-row__d ro-val" id="set-voice-val">{voice?.state==='found'?voice.voiceName??'—':'—'}</span></span></li></ul>;
}
export function VoiceSpeedPart({company,agent,canManage,asked}:{company:string,agent:string,canManage:boolean,asked:number}) {
 const read=useAgentPart<VoiceRead|null>(company,agent,'voice',asked);
 const voice=read.data;
 return <AgentVoiceSpeed agent={agent} speed={voice?.state==='found'?voice.speed:null} editable={canManage&&voice?.state==='found'&&voice.own}/>;
}

// What the Agent may do without asking again (#166): an Engine that cannot be read, or a read still on its way, draws no
// section, as an empty list does.
export function PermissionsPart({company,agent,canRevoke,asked}:{company:string,agent:string,canRevoke:boolean,asked:number}) {
 const read=useAgentPart<Permissions>(company,agent,'permissions',asked);
 return <StandingPermissions key={agent} company={company} agent={agent} permissions={read.data?.permissions??none} canRevoke={canRevoke} heading="h5"/>;
}

// The Agent's own Skills and their switches (#180), switchable by the Owner and Managers on its own profile once listed.
export function SkillsPart({company,agent,name,slug,learning,canManage,asked}:{company:string,agent:string,name:string,slug:string,learning:boolean,canManage:boolean,asked:number}) {
 const {t}=useI18n();
 const read=useAgentPart<Skills>(company,agent,'skills',asked);
 if(reading(read)) return <section className="dp-sec" aria-labelledby="set-h-skills"><h5 className="dp-label" id="set-h-skills"><span>{t('settingsSkills')}</span></h5><PartReading/></section>;
 const skills=read.data;
 return <AgentSkills agent={agent} name={name} slug={slug} learning={learning} skills={skills?.state==='found'?skills.skills:null} editable={canManage&&skills?.state==='found'&&skills.own}/>;
}
