import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { attachmentHeaders } from '@/lib/attachments.mjs';
import { permitted, routeAllowed } from '@/lib/route-permissions.mjs';
import { agentFileDownload } from '@/lib/agent-files.mjs';

// One file of an Agent's Library (#194, #353), for the download link beside it: one folder of one of the Agent's own
// Engine profile's two roots — its work folder or its generated images folder — fetched by gtmworks and never by an
// address the browser holds. A person outside the Company finds nothing, as for any other page of that Company; a
// Member below Manager is refused; the Agent must be one this person sees in this Company, so a hidden Agent and
// another Company's Agent are not found. The root is one of the Library's two names and is refused otherwise; the name is
// a plain name inside the folder: `..`, an absolute path and a link out of the folder are refused before the Engine is
// asked for bytes. The response carries the file's name and type only — never an Engine address or a path on its disk.
// An Engine or a work sandbox that cannot be reached is a service down (503), never a file that is gone (#395).
export async function GET(request:NextRequest,{params}:{params:Promise<{slug:string,agent:string}>}) {
 const {slug,agent}=await params;
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return new Response('Not found',{status:404});
 const {data:company}=await db.from('companies').select('id').eq('slug',slug).maybeSingle();
 if(!company) return new Response('Not found',{status:404});
 if(!await permitted(db,'viewer',company.id,user.id)) return new Response('Not found',{status:404});
 if(!await routeAllowed(db,'app/c/[slug]/agent-files/[agent]/route.ts','GET',company.id,user.id)) return new Response('Forbidden',{status:403});
 const folder=request.nextUrl.searchParams.get('folder')??'';
 const name=request.nextUrl.searchParams.get('name')??'';
 const root=request.nextUrl.searchParams.get('root')??'work';
 if(root!=='work'&&root!=='images') return new Response('Bad request',{status:400});
 const file=await agentFileDownload(db,{company:company.id,agent,folder,name,root});
 if(file.state==='unreachable') return new Response('Service unavailable',{status:503});
 if(file.state!=='found') return new Response('Not found',{status:file.state==='tooLarge'?413:404});
 return new Response(file.body.buffer,{headers:attachmentHeaders({name:file.name,content_type:file.type})});
}
