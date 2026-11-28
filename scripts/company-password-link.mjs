import { createClient } from '@supabase/supabase-js';
import { generateLinkSecret, linkSecretHash, passwordLink } from '../lib/company-link.mjs';
import { appUrl } from '../lib/app-origin.mjs';

// `gtmworks company password-link` (#955, ADR 0019) runs this inside the web container: the install owner names a Company
// and an Administrator's email, and it prints that Administrator's password link, the way back in for a Company's last
// Administrator and for the install owner, whose link no Administrator makes from the Team page (#915). A Company the
// install does not have, an email that names no Person, and a Person who is not an active Administrator of that Company
// are refused and nothing is written. The secret is made here and only its hash reaches the database, so it appears only
// in the printed link, never in a log.
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL||'http://gateway:8080',process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const option=name=>{ const at=process.argv.indexOf(`--${name}`); return at>0?process.argv[at+1]||'':''; };
const sayError=message=>{ console.error(message); process.exitCode=1; };
const press=async query=>{ const {data,error}=await query; if(error) throw new Error(error.message); return data; };
const company=option('company').trim(), email=option('email').trim();
// An email names an existing Person: an Auth user that has a person row. A signed-up user without one is nobody here.
const personByEmail=async email=>{
 for(let page=1;;page++) {
  const {data,error}=await service.auth.admin.listUsers({page,perPage:1000});
  if(error) throw new Error(error.message);
  const user=data.users.find(found=>String(found.email||'').toLowerCase()===email.toLowerCase());
  if(user) {
   const person=await press(service.from('people').select('id').eq('id',user.id).maybeSingle());
   return person?user:null;
  }
  if(data.users.length<1000) return null;
 }
};

try {
 if(!company||!email) sayError('Usage: company-password-link.mjs --company <Company> --email <email>');
 else {
  // The install owner's own command reads the install's Companies and accounts, as `company add` does, to name the one
  // Company and the one Person it is given; it is the server's command, not a Member's request.
  const companies=await press(service.from('companies').select('id,name'));
  const matches=companies.filter(one=>one.id===company||one.name.toLowerCase()===company.toLowerCase());
  if(!matches.length) sayError(`No Company in this install is named ${company}. Pass the Company's id or its exact name.`);
  else if(matches.length>1) sayError(`More than one Company in this install is named ${company}. Pass the Company's id instead.`);
  else {
   const person=await personByEmail(email);
   if(!person) sayError(`No Person on this install has the email ${email}. Nothing was changed.`);
   else {
    const secret=generateLinkSecret();
    const {error}=await service.rpc('make_administrator_password_link',{c:matches[0].id,person:person.id,link_hash:linkSecretHash(secret)});
    if(error) sayError(error.message==='passwordLinkNotAdministrator'?`${person.email} is not an Administrator of "${matches[0].name}". Nothing was changed.`
      :`The password link for ${person.email} in "${matches[0].name}" could not be made: ${error.message}`);
    else process.stdout.write(`Password link for ${person.email} in "${matches[0].name}": ${passwordLink(appUrl('/').origin,secret)}\n`);
   }
  }
 }
} catch(error) {
 sayError(`The password link could not be made: ${error.message}`);
}
