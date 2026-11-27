import { NextRequest, NextResponse } from 'next/server';
import { uuid } from '@/lib/company-apps.mjs';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { bodyLengthRefused } from '@/lib/attachments.mjs';
import { routePermission } from '@/lib/route-permissions.mjs';
import { addCardFile, cardFileLimit } from '@/lib/company-card-files.mjs';

// A person adds a file to a Card (spec #831, #843): one file of a form, `company`, `card` and `file`, made a Kanban
// attachment on the Company's Engine under the person's name (lib/company-card-files.mjs). An Owner, a Manager or a
// Contributor; a Viewer is refused here before anything reaches the Engine, and a person who is no Member finds no such
// Card. A file past the Engine's own cap is refused before its bytes are read: the form may be at most the cap and the
// room its other fields take, and a form that declares no length is refused too. No answer names the Engine, its address,
// its key, a profile or where the Engine keeps the file.
const file='app/api/board/card/files/route.ts';
const formRoom=64*1024;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const failures:Record<string,[string,number]>={invalid:['cardFileInvalid',400],tooLarge:['cardFileTooLarge',413],missing:['cardNotFound',404],archived:['cardArchived',409],
 noEngine:['cardNoEngine',503],unreachable:['cardUnreachable',503],failed:['cardUnreachable',503]};

export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'cardNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('multipart/form-data')||crossSiteWrite(request.headers)) return reply({error:'cardNotAllowed'},403);
  if(bodyLengthRefused(request.headers.get('content-length'),cardFileLimit+formRoom)) return reply({error:'cardFileTooLarge'},413);
  const company=request.nextUrl.searchParams.get('company'); const card=request.nextUrl.searchParams.get('card');
  if(!company||!uuid.test(company)||!card||!/^[A-Za-z0-9_-]{1,64}$/.test(card)) return reply({error:'cardInvalid'},400);
  const allowed=await routePermission(db,file,'POST',company,user.id);
  if(allowed==='failed') return reply({error:'cardUnreachable'},503);
  if(allowed!=='allowed') {
   // A Member below the Role is refused; anyone else finds no such Card, as the page answers them.
   const {data:member}=await db.from('members').select('role').eq('company_id',company).eq('person_id',user.id).is('removed_at',null).maybeSingle();
   return member?reply({error:'cardNotAllowed'},403):reply({error:'cardNotFound'},404);
  }
  const chosen=(await request.formData()).get('file');
  if(!(chosen instanceof File)) return reply({error:'cardFileInvalid'},400);
  if(chosen.size>cardFileLimit) return reply({error:'cardFileTooLarge'},413);
  const added=await addCardFile(db,{company,card,person:user.id,file:{name:chosen.name,type:chosen.type,body:new Uint8Array(await chosen.arrayBuffer())}});
  if(added.state==='attached') return reply({added:true});
  const [error,status]=failures[added.state]; return reply({error},status);
 } catch { return reply({error:'cardFailed'},500); }
}
