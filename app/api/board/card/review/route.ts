import { NextRequest } from 'next/server';
import { routePermission } from '@/lib/route-permissions.mjs';
import { passCard, sendBackCard } from '@/lib/company-card-review.mjs';
import { notAllowed, refusals, reply, withBoard, writing } from '../writer';

// A review a person decides (spec #831, #839): `pass` completes a Card that waits on a review with its Agent's summary and
// a line naming the person; `sendBack` writes the reason as a comment under their name and sends the Card back to its
// Agent, whose next Run reads it. An Owner or a Manager; a Contributor and a Viewer are refused here, before anything
// reaches the Engine. The answer carries the board as it now reads; none names the Engine, its address, its key or a
// profile.
export async function POST(request:NextRequest) {
 try {
  const who=await writing(request); if('answer' in who) return who.answer;
  const refused=await notAllowed(who,await routePermission(who.db,'app/api/board/card/review/route.ts','POST',who.company,who.person)); if(refused) return refused;
  const {action,card,reason}=who.sent;
  if(action!=='pass'&&action!=='sendBack') return reply({error:'cardInvalid'},400);
  const done=action==='pass'?await passCard(who.db,{company:who.company,person:who.person,card})
   :await sendBackCard(who.db,{company:who.company,person:who.person,card,reason});
  if(done.state==='passed'||done.state==='sentBack') return await withBoard(who.db,who.company,{[done.state]:card});
  const [error,status]=done.state==='notInReview'?['cardNotInReview',409]:refusals[done.state]; return reply({error},status);
 } catch { return reply({error:'boardFailed'},500); }
}
