import { cache } from 'react';
import { signedInUser, supabase } from './supabase';
import { mustRead } from './read-failed';

type ReaderCompany={id:string,slug:string,name:string,work_mode:string|null};

// The signed-in person, the Companies they belong to and the one the address names, read together once per request;
// signed out it is null, and a Company they do not belong to has no `company`.
export const companyOf=cache(async(slug:string)=>{
 const db=await supabase();
 const [{data:{user}},companiesRead]=await Promise.all([signedInUser(),db.from('companies').select('id,slug,name,work_mode').order('name')]);
 if(!user) return null;
 const companies=(mustRead(companiesRead,'companies')||[]) as ReaderCompany[];
 return {user,companies,company:companies.find(c=>c.slug===slug)};
});

// Who reads a Company's page (#789): companyOf with their name and their Role there. Worked out once per request, so the
// Company's layout (its Shell) and the page under it share one read of each. A page that has more to read first starts
// it beside its own reads and awaits it with them.
export const companyReader=cache(async(slug:string)=>{
 const of=await companyOf(slug);
 if(!of) return null;
 const {user,company}=of;
 if(!company) return {...of,person:null,role:''};
 const db=await supabase();
 const [{data:person},membershipRead]=await Promise.all([
  db.from('people').select('name').eq('id',user.id).single(),
  db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle(),
 ]);
 return {...of,person:person as {name:string}|null,role:String(mustRead(membershipRead,'membership')?.role||'')};
});
