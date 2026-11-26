import { supabase } from '@/lib/supabase';
import { attachmentHeaders } from '@/lib/attachments.mjs';
import { routePermission } from '@/lib/route-permissions.mjs';
import { readCardFile } from '@/lib/company-card-files.mjs';

// One file of a Card on the Engine's board (spec #831, #843), by its key on the Card: a person's, read from the
// Company's Engine, or one an Agent named by a MEDIA line, read from its own work folder in the work sandbox
// (lib/company-card-files.mjs). Any Member who sees the Card reads it, a Viewer included, with the headers every person's
// file has (lib/attachments.mjs): a raster image inline, so the Card draws it as a thumbnail, anything else downloaded.
// Someone outside the Company, a Card of an Agent hidden from the reader, and a file the Card does not hold all find the
// missing page, alike; an Engine or a work sandbox that cannot be read now answers 503, never a file that is gone.
const notFound=()=>new Response('Not found',{status:404});
const notNow=()=>new Response('Could not be read now',{status:503,headers:{'Retry-After':'30','Cache-Control':'no-store'}});

export async function GET(_request:Request,{params}:{params:Promise<{slug:string,card:string,file:string}>}) {
 const {slug,card,file}=await params;
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return notFound();
 const company=await db.from('companies').select('id').eq('slug',slug).maybeSingle();
 if(company.error) return notNow();
 if(!company.data) return notFound();
 const allowed=await routePermission(db,'app/c/[slug]/files/board/[card]/[file]/route.ts','GET',company.data.id,user.id);
 if(allowed==='failed') return notNow();
 if(allowed!=='allowed') return notFound();
 const read=await readCardFile(db,{company:company.data.id,card,file});
 if(read.state==='found') return new Response(read.body.buffer as ArrayBuffer,{headers:attachmentHeaders({name:read.name,content_type:read.type})});
 if(read.state==='tooLarge') return new Response('Too large',{status:413});
 return read.state==='missing'?notFound():notNow();
}
