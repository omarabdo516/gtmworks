import { NextRequest } from 'next/server';
import { routePermission } from '@/lib/route-permissions.mjs';
import { commentOnCard } from '@/lib/company-card-talk.mjs';
import { notAllowed, refusals, reply, withBoard, writing } from '../writer';

// A comment on a Card, and an answer to its Agent's question (spec #831, #838): POST writes the comment on the Card's task
// on the Company's Engine under the writer's name; with `answer` it also lets the Card stopped on that question go on, so
// its Agent's next Run reads the answer at once. An Owner, a Manager or a Contributor; a Viewer is refused here, before
// anything reaches the Engine. The answer carries the board as it now reads; none names the Engine, its address, its key
// or a profile.
export async function POST(request:NextRequest) {
 try {
  const who=await writing(request); if('answer' in who) return who.answer;
  const refused=await notAllowed(who,await routePermission(who.db,'app/api/board/card/comments/route.ts','POST',who.company,who.person)); if(refused) return refused;
  const done=await commentOnCard(who.db,{company:who.company,person:who.person,card:who.sent.card,body:who.sent.body,answer:who.sent.answer===true});
  if(done.state==='commented'||done.state==='answered') return await withBoard(who,{[done.state]:who.sent.card});
  const [error,status]=refusals[done.state]; return reply({error},status);
 } catch { return reply({error:'boardFailed'},500); }
}
