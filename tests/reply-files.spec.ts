import { test, expect, type Page } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #708, ADR 0028: an Agent hands a file it made in its own work folder in its reply, by a `MEDIA:` line. The reply shows
// it as the file chip a person's message shows, an image as a thumbnail, and the chip downloads the same bytes; a tag
// outside the Agent's folder shows no path, only a line saying that file could not be attached. The Agent's details list
// the file with the Conversation's other files.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const companyProfile=`co-${company.replaceAll('-','')}`;
const pdf=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');

test.use({actionTimeout:15000});

async function ownerSignIn(page:Page) {
 query(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
}

test('an Agent\'s reply hands over a PDF and an image from its work folder, and names a file it could not attach',async({page})=>{
 test.setTimeout(120000);
 const fake=await laneHermes();
 try {
  const id=randomUUID(); const profile=`ag-${id.replaceAll('-','')}`; const work=`/opt/data/work/${profile}`;
  fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
  fake.settings.files.set(work,[{name:'report',isFolder:true}]);
  fake.settings.files.set(`${work}/report`,[{name:'market-vs-platform-report.pdf',size:pdf.length},{name:'page-01.png',size:png.length}]);
  fake.settings.fileBytes.set(`${work}/report/market-vs-platform-report.pdf`,{body:pdf,type:'application/pdf'});
  fake.settings.fileBytes.set(`${work}/report/page-01.png`,{body:png,type:'image/png'});
  fake.settings.reply=()=>`The report is ready.\nMEDIA:/work/${profile}/report/market-vs-platform-report.pdf\nMEDIA:/work/${profile}/report/page-01.png\nMEDIA:/opt/data/auth.json`;
  query(`do $$ begin
    insert into public.agent_profiles(agent_id,company_id,tools_confirmed,skills_shared) values ('${id}','${company}',true,true);
    update public.hermes_agents set is_default=false where company_id='${company}' and is_default;
    insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${id}','${company}','${randomUUID()}','Trainer','Training',true,'${profile}');
    insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${company}','${companyProfile}',true)
     on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   end $$;`);
  await ownerSignIn(page);
  await page.goto('/c/rs-learning/chat');
  await page.getByLabel('Message',{exact:true}).fill('Send me the report as a file');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
  // Every Run is told how a file is handed over, in the Agent's own folder.
  expect(fake.settings.runs.at(-1)?.instructions).toContain(`MEDIA:/work/${profile}/<path to the file>`);

  const reply=page.locator('.msg[data-author=agent]').last();
  await expect(reply.locator('.bubble--agent')).toHaveText('The report is ready.');
  const chip=reply.locator('.msg-files a.file-chip',{hasText:'market-vs-platform-report.pdf'});
  await expect(chip).toBeVisible();
  await expect(reply.locator('.msg-files a.file-thumb img')).toBeVisible();
  await expect(reply.locator('[data-outcome=file-missed]')).toHaveText(/^auth\.json couldn’t be attached\./);
  // No path reaches the page.
  await expect(page.locator('.turns')).not.toContainText('MEDIA:');
  await expect(page.locator('.turns')).not.toContainText('/work/');
  await expect(page.locator('.turns')).not.toContainText('/opt/data');

  // The chip downloads the very bytes the Agent made; the image opens inline.
  const pdfHref=await chip.getAttribute('href');
  expect(pdfHref).toMatch(/^\/c\/rs-learning\/files\/conversation\/\d+$/);
  const download=await page.request.get(pdfHref!);
  expect(download.status()).toBe(200);
  expect(Buffer.from(await download.body()).equals(pdf)).toBe(true);
  expect(download.headers()['content-disposition']).toMatch(/^attachment;/);
  const imageHref=await reply.locator('.msg-files a.file-thumb').getAttribute('href');
  const image=await page.request.get(imageHref!);
  expect(Buffer.from(await image.body()).equals(png)).toBe(true);
  expect(image.headers()['content-type']).toBe('image/png');

  // The Agent's details list the delivered files with the Conversation's other files.
  await page.goto(`/c/rs-learning/chat/${id}`);
  const details=page.getByRole('complementary',{name:'Details: Trainer',exact:true});
  await details.getByRole('tab',{name:'Files',exact:true}).click();
  await expect(details.getByRole('tabpanel')).toContainText('market-vs-platform-report.pdf');
 } finally { await fake.close(); }
});
