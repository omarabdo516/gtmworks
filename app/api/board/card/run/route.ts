import { NextRequest } from 'next/server';
import { routePermission } from '@/lib/route-permissions.mjs';
import { continueCard, stopCard } from '@/lib/company-card-talk.mjs';
import { notAllowed, refusals, reply, withBoard, writing } from '../writer';

// Stop and Continue on a Card (spec #831, #838): `stop` ends the Card's open Run on the Company's Engine and holds the
// Card until a person lets it go on; `continue` lets a Card stopped after two failures, or stopped by a person, go on, and
// the Engine tries it again now. An Owner, a Manager or a Contributor; a Viewer is refused here, before anything reaches
// the Engine. The answer carries the board as it now reads; none names the Engine, its address, its key or a profile.
export async function POST(request:NextRequest) {
 try {
  const who=await writing(request); if('answer' in who) return who.answer;
  const refused=await notAllowed(who,await routePermission(who.db,'app/api/board/card/run/route.ts','POST',who.company,who.person)); if(refused) return refused;
  const {action,card}=who.sent;
  if(action!=='stop'&&action!=='continue') return reply({error:'cardInvalid'},400);
  const done=action==='stop'?await stopCard(who.db,{company:who.company,person:who.person,card}):await continueCard(who.db,{company:who.company,card});
  if(done.state==='stopped'||done.state==='continued') return await withBoard(who.db,who.company,{[done.state]:card});
  const [error,status]=refusals[done.state]; return reply({error},status);
 } catch { return reply({error:'boardFailed'},500); }
}
