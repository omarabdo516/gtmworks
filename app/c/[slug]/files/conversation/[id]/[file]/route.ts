import { supabase } from '@/lib/supabase';
import { attachmentHeaders } from '@/lib/attachments.mjs';
import { routePermission } from '@/lib/route-permissions.mjs';
import { uuid } from '@/lib/conversations';
import { readConversationFile } from '@/lib/conversation-messages';

// One file of a Conversation whose messages are the Engine's (#880), by its key under its message: a person's image,
// read from the message in the Engine's session that carried it to the Agent, or a file the Agent's reply named by a
// MEDIA line, read from that Agent's own work folder in the Company's work sandbox. gtmworks keeps no copy of either
// (lib/conversation-messages.ts readConversationFile). Only the Conversation's own person reads it, with the headers
// every person's file has (lib/attachments.mjs): a raster image inline, so the page draws it, anything else downloaded.
// Another Member, someone outside the Company and a file the Conversation does not hold all find the missing page,
// alike; an Engine or a work sandbox that cannot be read now answers 503, never a file that is gone.
// The `[id]` here is the Conversation's.
const notFound=()=>new Response('Not found',{status:404});
const notNow=()=>new Response('Could not be read now',{status:503,headers:{'Retry-After':'30','Cache-Control':'no-store'}});

export async function GET(_request:Request,{params}:{params:Promise<{slug:string,id:string,file:string}>}) {
 const {slug,id,file}=await params;
 if(!uuid.test(id)) return notFound();
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return notFound();
 const company=await db.from('companies').select('id').eq('slug',slug).maybeSingle();
 if(company.error) return notNow();
 if(!company.data) return notFound();
 const allowed=await routePermission(db,'app/c/[slug]/files/conversation/[id]/[file]/route.ts','GET',company.data.id,user.id);
 if(allowed==='failed') return notNow();
 if(allowed!=='allowed') return notFound();
 const read=await readConversationFile(db,{company:company.data.id,person:user.id,conversation:id,file});
 if(read.state==='found') return new Response(read.body.buffer as ArrayBuffer,{headers:attachmentHeaders({name:read.name,content_type:read.type})});
 if(read.state==='tooLarge') return new Response('Too large',{status:413});
 return read.state==='missing'?notFound():notNow();
}
