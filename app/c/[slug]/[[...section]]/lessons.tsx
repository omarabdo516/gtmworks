import { getI18n } from '@/lib/i18n-server';
import Link from '@/lib/link';
import en from '@/lib/messages/lessons.en.json';
import ar from '@/lib/messages/lessons.ar.json';
import { decideSkillLesson } from './skill-actions';
type Lesson={id:number,card_id:number,lesson:string,reason:string,skills:{slug:string}|null};
// A server component: it ships no client JavaScript, which the route size budget counts. Its strings live in lessons.en.json and lessons.ar.json
// (checked like the main catalogues) because the main ones are bundled for the browser. Shown only to people who may decide.
export default async function SkillLessons({company,slug,lessons,cards,failed}:{company:string,slug:string,lessons:Lesson[],cards:{id:number,title:string}[],failed?:boolean}) { const {language}=await getI18n(); const text:Record<string,string>=language==='ar'?ar:en; const s=(key:string,...values:unknown[])=>text[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 if(lessons.length===0 && !failed) return null;
 return <section className="panel agents-panel section-title skills-controls"><h2>{s('lessonsAwaitingApproval')}<span className="approval-count">{lessons.length}</span></h2><p>{s('lessonsIntro')}</p>
  {failed&&<p role="alert">{s('lessonCouldNotBeDecided')}</p>}
  <div className="detail-rows">{lessons.map(item=>{ const skill=item.skills?.slug || ''; const card=cards.find(candidate=>candidate.id===item.card_id);
   return <div key={item.id} className="detail-row" role="group" aria-label={s('lessonFor',skill)}><div className="agent-row-main">
    <strong dir="auto">{s('lessonFor',skill)}</strong>
    <p>{s('lessonAddsTo',skill)}</p>
    <p className="lesson-change" dir="auto"><ins>{item.lesson}</ins></p>
    <p><strong>{s('lessonReason')}</strong>{' '}<span dir="auto">{item.reason}</span></p>
    <p><strong>{s('lessonLearnedOn')}</strong>{' '}<Link className="link" href={`/c/${slug}/work/board/${item.card_id}`}><span dir="auto">{card?.title ?? `#${item.card_id}`}</span></Link></p>
    <form action={decideSkillLesson} className="agent-create-form"><input type="hidden" name="company" value={company}/><input type="hidden" name="slug" value={slug}/><input type="hidden" name="lesson" value={item.id}/>
     <button className="button primary" name="intent" value="approve" aria-label={s('approveLessonFor',skill)}>{s('approveLesson')}</button>
     <button className="button" name="intent" value="reject" aria-label={s('rejectLessonFor',skill)}>{s('rejectLesson')}</button></form>
   </div></div>;})}</div></section>;
}
