import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// Spec #831 (#843): a Card's files, both ways, in the Card window on the Company's fake Engine. A person adds a file and
// every Member who opens the Card sees it and downloads it, an image as a thumbnail; a file past the Engine's cap is
// refused before it is sent, with the cap named. A file the Agent named in its summary or a comment by a MEDIA line is
// listed and downloads, read from the work sandbox; with the sandbox stopped it says it cannot be read now while the
// person's still download. A Viewer downloads and cannot add, and someone outside a Company finds the missing page.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rs='10000000-0000-0000-0000-000000000001';
const rsProfile=`co-${rs.replaceAll('-','')}`;
const ads=randomUUID(), adsProfile=`ag-${ads.replaceAll('-','')}`;
const viewer='20000000-0000-0000-0000-000000000004';
const board='/c/rs-learning/work/board';
// The smallest PNG: one transparent pixel.
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==','base64');
let fake:Awaited<ReturnType<typeof laneHermes>>;
let reel='';

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${rs}');
   insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${ads}','${rs}','Ads','Runs the ads.',false,'${adsProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${rs}','${rsProfile}',true)
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.member_agent_access(company_id,person_id,agent_id) values ('${rs}','${viewer}','${ads}');
  end $$;`);
 fake.settings.profiles.set(adsProfile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 // The Agent's own folder of the work folder, as the Engine's read-only mount lists it and the sandbox serves it.
 fake.settings.files.set(`/opt/data/work/${adsProfile}`,[{name:'reel',isFolder:true}]);
 fake.settings.files.set(`/opt/data/work/${adsProfile}/reel`,[{name:'final.mp4',size:12},{name:'frame.png',size:pixel.length}]);
 fake.settings.fileBytes.set(`/opt/data/work/${adsProfile}/reel/final.mp4`,{body:'the cut reel',type:'video/mp4'});
 fake.settings.fileBytes.set(`/opt/data/work/${adsProfile}/reel/frame.png`,{body:new Uint8Array(pixel),type:'image/png'});
 const kanban=fake.settings.kanban;
 reel=kanban.task({title:'Course reel',status:'done',assignee:adsProfile}).id;
 kanban.attach(reel,{filename:'brief.pdf',body:'%PDF the brief',content_type:'application/pdf',uploaded_by:'عمر'});
 kanban.attach(reel,{filename:'reference.png',body:new Uint8Array(pixel),content_type:'image/png',uploaded_by:'عمر'});
 kanban.comment(reel,adsProfile,`A frame from the cut:\nMEDIA:/work/${adsProfile}/reel/frame.png`);
 kanban.run(reel,{profile:adsProfile,status:'done',outcome:'completed',ended_at:Math.floor(Date.now()/1000),summary:`The reel is cut.\nMEDIA:/work/${adsProfile}/reel/final.mp4`});
});
test.afterAll(async()=>{ await fake?.close(); });

const windowOf=(page:Page)=>page.getByRole('dialog');
const filesRow=(page:Page)=>windowOf(page).locator('.cw-files-row');
const fileLink=(page:Page,name:string)=>filesRow(page).getByRole('link',{name:`Download ${name}`});

test('every file of the Card is listed and downloads: a person\'s, an image as a thumbnail, and the ones the Agent named',async({page})=>{
 await signIn(page,'omar@example.com',`${board}?card=${reel}`);
 const sheet=windowOf(page);
 await expect(filesRow(page).locator('.cw-fl .cw-file bdi')).toHaveText(['brief.pdf','reference.png','final.mp4','frame.png']);
 // The summary and the comment read without their tags, each with its file under it.
 await expect(sheet.locator('.cw-sum')).toHaveText('The reel is cut.');
 await expect(sheet.locator('.cw-result .cw-file bdi')).toHaveText(['final.mp4']);
 await expect(sheet.locator('.lg-note')).toHaveText(['A frame from the cut:']);
 await expect(sheet.locator('.lg-body .cw-file bdi')).toHaveText(['frame.png']);
 await expect(sheet).not.toContainText('MEDIA:');
 // An image is a thumbnail of itself, drawn from gtmworks's own address.
 const thumbs=filesRow(page).locator('.cw-thumb img');
 await expect(thumbs).toHaveCount(2);
 await expect.poll(()=>thumbs.first().evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBe(1);
 // Each downloads through gtmworks with the headers of a person's file.
 const pdf=await page.request.get((await fileLink(page,'brief.pdf').getAttribute('href'))!);
 expect(pdf.status()).toBe(200);
 expect(pdf.headers()['content-disposition']).toMatch(/^attachment;/);
 expect(pdf.headers()['content-type']).toBe('application/octet-stream');
 expect(pdf.headers()['content-security-policy']).toBe("sandbox; default-src 'none'");
 expect(await pdf.text()).toBe('%PDF the brief');
 const href=(await fileLink(page,'final.mp4').getAttribute('href'))!;
 expect(href).toMatch(new RegExp(`^/c/rs-learning/files/board/${reel}/`));
 expect(href).not.toContain('work');
 const cut=await page.request.get(href);
 expect(cut.status()).toBe(200);
 expect(await cut.text()).toBe('the cut reel');
 const picture=await page.request.get((await fileLink(page,'reference.png').getAttribute('href'))!);
 expect(picture.headers()['content-type']).toBe('image/png');
 expect(picture.headers()['content-disposition']).toMatch(/^inline;/);
 // Nothing the window holds names the Engine's paths or a profile.
 expect(await sheet.innerHTML()).not.toMatch(new RegExp(`${adsProfile}|/opt/data|/work/`));
});

test('a person adds a file to the Card and it is listed; one past the Engine\'s cap is refused before it is sent',async({page})=>{
 await signIn(page,'omar@example.com',`${board}?card=${reel}`);
 const sheet=windowOf(page);
 await expect(filesRow(page).locator('.cw-fl')).toHaveCount(4);
 const before=fake.settings.kanban.attachments.length;
 const sent:string[]=[];
 page.on('request',request=>{ if(request.url().includes('/api/board/card/files')) sent.push(request.url()); });
 await sheet.locator('input[type="file"]').setInputFiles({name:'film.mov',mimeType:'video/quicktime',buffer:Buffer.alloc(25*1024*1024+1)});
 await expect(sheet.getByRole('alert')).toHaveText('“film.mov” wasn’t added: a card’s file can be at most 25 MB.');
 expect(sent).toEqual([]);
 expect(fake.settings.kanban.attachments.length).toBe(before);
 await expect(filesRow(page).getByRole('button',{name:'Add files'})).toBeVisible();
 await sheet.locator('input[type="file"]').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('shoot at noon')});
 await expect(sheet.getByRole('status').filter({hasText:'File added'})).toBeVisible();
 await expect(filesRow(page).locator('.cw-fl .cw-file bdi')).toContainText(['notes.txt']);
 const added=fake.settings.kanban.attachments.at(-1)!;
 expect([added.task_id,added.filename,added.uploaded_by,Buffer.from(added.body).toString()]).toEqual([reel,'notes.txt','عمر','shoot at noon']);
 await expect(fileLink(page,'notes.txt')).toHaveAttribute('title',/^عمر/);
});

test('with the work sandbox stopped the Agent\'s files say they cannot be read now, and the person\'s still download',async({page})=>{
 fake.settings.sandboxDown=true;
 try {
  await signIn(page,'omar@example.com',`${board}?card=${reel}`);
  const final=filesRow(page).locator('.cw-fl',{hasText:'final.mp4'});
  await expect(final.locator('.cw-fl__note')).toHaveText('Can’t be read now: the work sandbox is stopped.');
  await expect(final.getByRole('link')).toHaveCount(0);
  await expect(filesRow(page).locator('.cw-fl',{hasText:'frame.png'}).locator('.cw-thumb')).toHaveCount(0);
  expect((await page.request.get(`/c/rs-learning/files/board/${reel}/s0`)).status()).toBe(503);
  const pdf=await page.request.get((await fileLink(page,'brief.pdf').getAttribute('href'))!);
  expect(pdf.status()).toBe(200);
  expect(await pdf.text()).toBe('%PDF the brief');
 } finally { fake.settings.sandboxDown=false; }
});

test('a Viewer sees and downloads the Card\'s files and cannot add one; outside the Company a file\'s address is the missing page',async({page})=>{
 await signIn(page,'viewer@example.com',`${board}?card=${reel}`);
 const sheet=windowOf(page);
 await expect(filesRow(page).locator('.cw-fl .cw-file bdi')).toContainText(['brief.pdf','reference.png','final.mp4','frame.png']);
 await expect(filesRow(page).getByRole('button')).toHaveCount(0);
 await expect(sheet.locator('input[type="file"]')).toHaveCount(0);
 const pdf=await page.request.get((await fileLink(page,'brief.pdf').getAttribute('href'))!);
 expect(pdf.status()).toBe(200);
 expect((await page.request.get(`/c/rs-learning/files/board/${reel}/s0`)).status()).toBe(200);
 const before=fake.settings.kanban.attachments.length;
 const refused=await page.request.post(`/api/board/card/files?company=${rs}&card=${reel}`,{multipart:{file:{name:'x.txt',mimeType:'text/plain',buffer:Buffer.from('x')}}});
 expect(refused.status()).toBe(403);
 expect(fake.settings.kanban.attachments.length).toBe(before);
 // Aleem is a Company the Viewer is no Member of: a file's address there is the missing page, whatever it names.
 const outside=await page.request.get(`/c/aleem/files/board/${reel}/a1`);
 expect(outside.status()).toBe(404);
 expect(await outside.text()).not.toContain('PDF');
 expect((await page.request.post(`/api/board/card/files?company=10000000-0000-0000-0000-000000000003&card=${reel}`,{multipart:{file:{name:'x.txt',mimeType:'text/plain',buffer:Buffer.from('x')}}})).status()).toBe(404);
 // A file the Card does not hold is the missing page too.
 expect((await page.request.get(`/c/rs-learning/files/board/${reel}/a999`)).status()).toBe(404);
});
