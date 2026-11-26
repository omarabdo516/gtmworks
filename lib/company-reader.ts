import { cache } from 'react';
import { signedInUser, supabase } from '@/lib/supabase';
import { mustRead } from '@/lib/read-failed';

type ReaderRole='owner'|'manager'|'contributor'|'viewer';

// Who reads a Company's page, worked out once per request (#789): the signed-in person, the Companies they are a
// Member of, the one at this address, and their Role and what it lets them do there. The Company's layout draws the
// Shell from it and each page reads it again for free. Null when nobody is signed in; `company` is null when the person
// is not a Member of a Company at this address, which every page answers with "not found". A failed read throws
// (lib/read-failed), never reads as "not a Member".
export const companyReader=cache(async(slug:string)=>{
 const db=await supabase(); const {data:{user}}=await signedInUser();
 if(!user) return null;
 const [companiesRead,personRead]=await Promise.all([
  db.from('companies').select('id,slug,name,work_mode').order('name'),
  db.from('people').select('name').eq('id',user.id).single(),
 ]);
 const companies=(mustRead(companiesRead,'companies')||[]) as {id:string,slug:string,name:string,work_mode:string|null}[];
 const company=companies.find(c=>c.slug===slug)??null;
 const membership=company?mustRead(await db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle(),'membership'):null;
 const role=(membership?.role??'') as ReaderRole|'';
 return {db,user,companies,company,personName:(personRead.data?.name as string|undefined)||user.email||'',role,
  owner:role==='owner',manage:role==='owner'||role==='manager',writer:!!role&&role!=='viewer'};
});
