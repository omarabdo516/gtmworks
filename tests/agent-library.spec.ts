import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { chooseLanguageInSettings } from './choose-language';
import { fileSize } from '../lib/agent-details.mjs';

// #194, #353, #395: the Library of an Agent is its own folder in the Company's work folder and the images it generated,
// read through the Engine and never copied into gtmworks. The Owner and Managers open it — the generated images folder
// leading the list, each folder with how many files it holds and when the newest was saved, a folder inside it, a file's
// download and the reference's toast — and a Contributor and a Viewer have none and are refused by the server. No page
// and no answer names the Engine or a path on its disk.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const companyProfile=`co-${company.replaceAll('-','')}`;
const agent=randomUUID();
const profile=`ag-${agent.replaceAll('-','')}`;
// The Agent's own folder of the Company's work folder, as the Engine's read-only mount of it lists it (#395).
const work=`/opt/data/work/${profile}`;
// A second Agent that has made nothing yet: the sandbox makes its folder at its first command, so the Engine has none.
const idle=randomUUID();
const idleProfile=`ag-${idle.replaceAll('-','')}`;
// The folder the Engine writes a generated image into (#353; agent/provider_media.py, GENERATED_SUBDIR, cache_dir).
const images=`/opt/data/profiles/${profile}/cache/generated/images`;
const at=Date.parse('2026-11-18T09:37:00Z')/1000;
const brief='# Brief\n\nSell more.\n';
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13]);
let fake:Awaited<ReturnType<typeof fakeHermes>>;

test.describe.configure({mode:'serial'});
test.use({timezoneId:'UTC'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 // The fake Engine holds the Agent's profile and the work folder the Engine makes in every profile, with two folders —
 // one of them empty — a folder inside the first, and a file beside them.
 fake=await laneHermes();
 for(const name of [profile,idleProfile]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.files.set(work,[{name:'reports',isFolder:true},{name:'empty',isFolder:true},{name:'brief.md',size:Buffer.byteLength(brief),mtime:at}]);
 fake.settings.files.set(`${work}/reports`,[{name:'2026',isFolder:true},{name:'q3.csv',size:12,mtime:at}]);
 fake.settings.files.set(`${work}/reports/2026`,[{name:'q3.csv',size:12,mtime:at}]);
 fake.settings.files.set(`${work}/empty`,[]);
 fake.settings.fileBytes.set(`${work}/brief.md`,{body:brief,type:'text/markdown'});
 // The Engine generated one image into the profile's own folder, and the folder it makes with it.
 fake.settings.images.set(profile,[{name:'promo.png',size:png.length,mtime:at}]);
 fake.settings.fileBytes.set(`${images}/promo.png`,{body:png,type:'image/png'});
 query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id) values ('${agent}','${company}');
   insert into public.agent_profiles(agent_id,company_id) values ('${idle}','${company}');
   insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${agent}','${company}','Librarian','Keeps the files.',false,'${profile}'),
    ('${idle}','${company}','Archivist','Has made nothing yet.',false,'${idleProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${companyProfile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.member_agent_access(company_id,person_id,agent_id) values
    ('${company}','20000000-0000-0000-0000-000000000003','${agent}'),
    ('${company}','20000000-0000-0000-0000-000000000004','${agent}');
  end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

async function openFiles(page:Page,email:string,{id=agent,name='Librarian'}={}) {
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,email,`/c/rs-learning/chat/${id}`);
 const details=page.getByRole('complementary',{name:`Details: ${name}`,exact:true});
 await expect(details).toBeVisible();
 await details.getByRole('tab',{name:'Files',exact:true}).click();
 const panel=details.getByRole('tabpanel');
 await expect(panel).toHaveAttribute('aria-labelledby','dp-tab-files');
 return {details,panel};
}

test('the Owner opens the Agent\'s Library above its files, its generated images and a folder inside it, and downloads a file from each',async({page})=>{
 const {panel}=await openFiles(page,'omar@example.com');
 // The Library is the Files tab's first section: its heading counts every file the Agent has in either root, the
 // generated images folder leads the list with its own count and newest day, each folder's row says how many it holds and
 // when the newest was saved or Empty, and the Files of its Cards and the reader's own Conversations stay below it.
 const library=panel.locator('.dp-library');
 await expect(library.locator('.dp-label')).toHaveText('Library of Librarian 3');
 await expect(panel.locator('.dp-label > span').nth(1)).toHaveText('Files 0');
 await expect(library.locator('li.lib-file').first()).toContainText('Generated images');
 await expect(library.getByRole('button',{name:/^Generated images/})).toHaveAccessibleName(/^Generated images One file · latest /);
 await expect(library.getByRole('button',{name:/^reports/})).toHaveAccessibleName(/^reports One file · latest /);
 await expect(library.getByRole('button',{name:/^empty/})).toHaveAccessibleName(/^empty Empty$/);
 await expect(library.getByRole('link',{name:'Download brief.md',exact:true})).toHaveAttribute('href',`/c/rs-learning/agent-files/${agent}?name=brief.md`);
 const briefRow=library.locator('li.lib-file').filter({hasText:'brief.md'});
 await expect(briefRow.locator('.panel-row__d')).toContainText(fileSize(Buffer.byteLength(brief)));
 await expect(briefRow.locator('time')).toHaveAttribute('datetime',new Date(at*1000).toISOString());
 // The hint, and the line that says the work folder is the Company's: every Agent of it can read and change it (#395).
 await expect(library.locator('.lib-hint')).toHaveText(['Files in Librarian’s folder in the company’s work folder, and the images it generated, show here. You can view and download them, and ask for edits in the chat.',
  'Every agent of the company can read and change these files.']);

 // A folder opens in place with its own count of files, the focus on the way back to the Library (the reference's
 // lib-open focuses #lib-root), and the way back puts the focus on that folder's row; a folder inside a folder opens
 // the same way.
 await library.getByRole('button',{name:/^reports/}).click();
 await expect(library.getByRole('heading',{name:'reports 1'})).toBeVisible();
 await expect(library.getByRole('button',{name:'Library of Librarian'})).toBeFocused();
 await expect(library.getByRole('button',{name:/^2026/})).toHaveAccessibleName(/^2026 One file · latest /);
 await expect(library.getByText('q3.csv')).toBeVisible();
 await library.getByRole('button',{name:'Library of Librarian'}).click();
 await expect(library.getByRole('button',{name:/^reports/})).toBeFocused();
 await library.getByRole('button',{name:/^reports/}).click();
 await library.getByRole('button',{name:/^2026/}).click();
 await expect(library.getByRole('heading',{name:'2026 1'})).toBeVisible();
 await expect(library.getByRole('button',{name:'Library of Librarian'})).toBeFocused();
 await library.getByRole('button',{name:'Library of Librarian'}).click();
 await expect(library.getByRole('button',{name:/^2026/})).toBeFocused();
 await library.getByRole('button',{name:'Library of Librarian'}).click();
 await library.getByRole('button',{name:/^empty/}).click();
 await expect(library.getByText('This folder is empty.')).toBeVisible();
 await library.getByRole('button',{name:'Library of Librarian'}).click();

 // "Download" saves the file under its own name, with the toast the reference shows, and the answer is the gtmworks
 // route's as an attachment — never an Engine address, and no path on its disk.
 const link=library.getByRole('link',{name:'Download brief.md',exact:true});
 await link.click();
 await expect(page.locator('.toast')).toContainText('Downloading “brief.md”');
 const file=await page.request.get((await link.getAttribute('href'))!);
 expect(file.status()).toBe(200);
 expect(file.headers()['content-disposition']).toBe("attachment; filename*=UTF-8''brief.md");
 expect(file.headers()['x-content-type-options']).toBe('nosniff');
 expect(await file.text()).toBe(brief);
 const answered=await page.request.get(`/api/agent-files?company=${company}&agent=${agent}`);
 expect(answered.status()).toBe(200);
 const body=await answered.text();
 expect(body).not.toContain('/opt/');
 expect(body).not.toContain(fake.address);
 expect(body).not.toMatch(/hermes/i);

 // The generated images folder opens as any folder of the Library — the focus on the way back, its picture's own
 // download — and its download is the same route: inline as a raster is, and no Engine address or disk path in the
 // answer the listing gave for it.
 await library.getByRole('button',{name:/^Generated images/}).click();
 await expect(library.getByRole('heading',{name:'Generated images 1'})).toBeVisible();
 await expect(library.getByRole('button',{name:'Library of Librarian'})).toBeFocused();
 const image=library.getByRole('link',{name:'Download promo.png',exact:true});
 await expect(image).toHaveAttribute('href',`/c/rs-learning/agent-files/${agent}?root=images&name=promo.png`);
 await image.click();
 await expect(page.locator('.toast').filter({hasText:'promo.png'})).toContainText('Downloading “promo.png”');
 const generatedFile=await page.request.get((await image.getAttribute('href'))!);
 expect(generatedFile.status()).toBe(200);
 expect(generatedFile.headers()['content-type']).toBe('image/png');
 expect(generatedFile.headers()['content-disposition']).toBe("inline; filename*=UTF-8''promo.png");
 expect([...new Uint8Array(await generatedFile.body())]).toEqual([...png]);
 await library.getByRole('button',{name:'Library of Librarian'}).click();
 await expect(library.getByRole('button',{name:/^Generated images/})).toBeFocused();
 const generatedAnswer=await page.request.get(`/api/agent-files?company=${company}&agent=${agent}&root=images`);
 expect(generatedAnswer.status()).toBe(200);
 const generatedBody=await generatedAnswer.text();
 expect(generatedBody).not.toContain('/opt/');
 expect(generatedBody).not.toMatch(/hermes/i);
 await expect(panel.locator('.dp-library')).not.toContainText(/hermes|\/opt\//i);
});

test('a Contributor and a Viewer have no Library, and the server refuses them',async({page})=>{
 for(const email of ['reviewer@example.com','viewer@example.com']) {
  await page.context().clearCookies();
  const {panel}=await openFiles(page,email);
  await expect(panel.locator('.dp-library')).toHaveCount(0);
  await expect(panel.locator('.dp-label > span')).toHaveText('Files 0');
  const listed=await page.request.get(`/api/agent-files?company=${company}&agent=${agent}&folder=reports`);
  expect(listed.status(),email).toBe(403);
  const generated=await page.request.get(`/api/agent-files?company=${company}&agent=${agent}&root=images`);
  expect(generated.status(),email).toBe(403);
  const file=await page.request.get(`/c/rs-learning/agent-files/${agent}?name=brief.md`);
  expect(file.status(),email).toBe(403);
 }
});

// #395: an Agent that has made nothing yet has no folder in the work folder, and its Library is empty rather than
// unreadable, promising only what the work folder and the generated images give it; the shared-folder line and the empty
// state read in English and in Egyptian Arabic.
test('the shared-folder line and an empty Library, in English and in Arabic',async({page})=>{
 const {panel}=await openFiles(page,'omar@example.com',{id:idle,name:'Archivist'});
 const library=panel.locator('.dp-library');
 await expect(library.locator('.lib-empty')).toHaveText('Nothing here yet. Files Archivist makes in its folder of the company’s work folder, and the images it generates, will show here.');
 await expect(library.locator('.lib-hint').nth(1)).toHaveText('Every agent of the company can read and change these files.');
 await expect(library).not.toContainText(/card/i);
 await chooseLanguageInSettings(page,'ar');
 try {
  await page.goto(`/c/rs-learning/chat/${idle}`);
  const details=page.getByRole('complementary',{name:'تفاصيل Archivist',exact:true});
  await expect(details).toBeVisible();
  await details.getByRole('tab',{name:'ملفات',exact:true}).click();
  const arabic=details.getByRole('tabpanel').locator('.dp-library');
  await expect(arabic.locator('.lib-empty')).toHaveText('مفيش حاجة هنا لسه. الملفات اللي Archivist هيعملها في فولدره جوّه فولدر شغل الشركة، والصور اللي هيطلّعها، هتظهر هنا.');
  await expect(arabic.locator('.lib-hint')).toHaveText(['ملفات Archivist اللي في فولدره جوّه فولدر شغل الشركة، والصور اللي عملها، بتظهر هنا. تقدر تشوفها وتنزّلها، والتعديل اطلبه منه في الشات.',
   'كل وكيل في الشركة يقدر يقرا الملفات دي ويغيّرها.']);
  // The Agent with files reads the same line in Arabic beside its Library.
  await page.goto(`/c/rs-learning/chat/${agent}`);
  const librarian=page.getByRole('complementary',{name:'تفاصيل Librarian',exact:true});
  await librarian.getByRole('tab',{name:'ملفات',exact:true}).click();
  await expect(librarian.getByRole('tabpanel').locator('.dp-library .lib-hint').nth(1)).toHaveText('كل وكيل في الشركة يقدر يقرا الملفات دي ويغيّرها.');
 } finally { await chooseLanguageInSettings(page,'en'); }
});
