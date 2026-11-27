import { test, expect, type Locator } from './fresh-seed';
import { signIn } from './sign-in';
import { execFileSync } from 'node:child_process';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});

const writer='30000000-0000-0000-0000-000000000001', name='وكيل المحتوى';
// Spec #695: a person shows its name's first letter (#697), named for assistive technology where its name is not written
// beside it; in a message the name beside it says who, and the letter is silent.
async function faceMarkup(face:Locator,label:string|null) {
 await expect(face).toBeVisible();
 if(label) await expect(face).toHaveAccessibleName(label);
 expect(await face.evaluate(element=>element.getAnimations({subtree:true}).length)).toBe(0);
 return face.innerHTML();
}

// An identity that was one of the old role agents is a removed membership now: what it wrote keeps its name and letter.
// Read on the Activity log (the old board, where its comments were drawn, is switched off, #846).
test('a log row keeps its writer\'s name and letter after the writer\'s membership is removed',async({page})=>{
 const stamp=Date.now();
 try {
  query(`insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,body,source,source_id,created_at)
   values ('10000000-0000-0000-0000-000000000001','${writer}','person','${name}','company','company_changed','{"field":"name","old":"RS","new":"RS Learning"}','Face history ${stamp}','company_audit',${stamp},now())`);
  await signIn(page,'manager@example.com',`/c/rs-learning/log?who=p:${writer}`);
  const row=page.locator('.lgp-body .lg-row').filter({hasText:`Face history ${stamp}`});
  await expect(row.locator('.lg-name')).toHaveText(name);
  const before=await faceMarkup(row.locator('.lg-av'),null);
  expect(await row.locator('.lg-av').textContent()).toBe('و');
  query(`update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='${writer}'`);
  await page.reload();
  await expect(row.locator('.lg-name')).toHaveText(name);
  expect(await faceMarkup(row.locator('.lg-av'),null)).toBe(before);
 } finally {
  query(`update public.members set removed_at=null where company_id='10000000-0000-0000-0000-000000000001' and person_id='${writer}'`);
 }
});
