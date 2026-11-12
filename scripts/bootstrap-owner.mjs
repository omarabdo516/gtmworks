import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export function validateEmail(email) {
 if(typeof email!=='string' || email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /\p{Cc}/u.test(email)) {
  throw new Error('usage: node scripts/bootstrap-owner.mjs <email>');
 }
 return email.toLowerCase();
}

export function bootstrapSql(email) {
 // Hex encoding keeps email data out of SQL syntax, including DO delimiters.
 const hex=Buffer.from(validateEmail(email)).toString('hex');
 return `do $bootstrap$
declare
 mail text := convert_from(decode('${hex}','hex'),'UTF8');
 person uuid; company uuid; owners integer;
begin
 -- Serialize the check and assignment, including competing membership writes.
 lock table public.companies, public.members in share row exclusive mode;
 select id into person from auth.users where lower(email)=mail;
 if person is null then raise exception 'Auth user must exist before bootstrap'; end if;
 select id into company from public.companies where slug='rs-learning';
 select count(*) into owners from public.members where company_id=company and role='owner' and removed_at is null;
 if owners>0 then
  if owners=1 and exists(select 1 from public.members where company_id=company and person_id=person and role='owner' and removed_at is null) then return; end if;
  raise exception 'RS Learning already has an Owner; bootstrap refuses a second Owner';
 end if;
 if company is null then
  company=gen_random_uuid();
  insert into public.companies(id,slug,name) values(company,'rs-learning','RS Learning');
 end if;
 -- OWNER_EMAIL is Omar: the Owner Membership below is what lets him manage the company and its agent engine.
 insert into public.people(id,name) values(person,split_part(mail,'@',1))
 on conflict(id) do nothing;
 insert into public.members(company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data)
 values(company,person,'owner',true,true,true)
 on conflict(company_id,person_id) do update set role='owner',removed_at=null,grant_publishing=true,grant_money_figures=true,grant_customer_data=true;
end $bootstrap$;`;
}

// Runs against the local Supabase stack only; there is no remote target.
function run(args) {
 if(args.length!==1) throw new Error('usage: node scripts/bootstrap-owner.mjs <email>');
 const sql=bootstrapSql(args[0]);
 const dir=mkdtempSync(join(tmpdir(),'gtmworks-owner-'));
 try {
  const file=join(dir,'bootstrap.sql');
  writeFileSync(file,sql,{mode:0o600});
  const query=spawnSync('supabase',['db','query','--file',file],{encoding:'utf8'});
  if(query.error || query.status!==0) throw new Error('Owner bootstrap failed: Auth user missing, an Owner already exists, or database query failed');
  console.log('RS Learning first Owner verified.');
 } finally { rmSync(dir,{recursive:true,force:true}); }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 try { run(process.argv.slice(2)); }
 catch(error) { console.error(error.message); process.exitCode=1; }
}
