import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #195, #395: a file's row in an Agent's Library opens a read-only preview — the picture, the text, the CSV's rows, or
// its icon and Download — with the keyboard on Download. The Library is the Agent's folder in the Company's work folder,
// as the Engine sees it read-only. The close button, Escape and a press on the backdrop each close it and give the
// keyboard back to the row, the download is the row's same file with the toast drawn inside the dialog, and a
// Contributor and a Viewer get no content from the read route. Nothing of an SVG or a page is ever drawn.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const companyProfile=`co-${company.replaceAll('-','')}`;
const agent=randomUUID();
const profile=`ag-${agent.replaceAll('-','')}`;
const work=`/opt/data/work/${profile}`;
const at=Date.parse('2026-11-18T09:37:00Z')/1000;
const brief='# Brief\n\nSell more.\n';
const long='a'.repeat(600*1024);
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13]);
const svg='<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>';
const csv='name,spend\nA,10\nB,20\n';
let fake:Awaited<ReturnType<typeof fakeHermes>>;

test.describe.configure({mode:'serial'});
test.use({timezoneId:'UTC'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.files.set(work,[
  {name:'brief.md',size:Buffer.byteLength(brief),mtime:at},
  {name:'long.txt',size:long.length,mtime:at},
  {name:'q3.csv',size:Buffer.byteLength(csv),mtime:at},
  {name:'shot.png',size:png.length,mtime:at},
  {name:'logo.svg',size:Buffer.byteLength(svg),mtime:at},
 ]);
 fake.settings.fileBytes.set(`${work}/brief.md`,{body:brief,type:'text/markdown'});
 fake.settings.fileBytes.set(`${work}/long.txt`,{body:long,type:'text/plain'});
 fake.settings.fileBytes.set(`${work}/q3.csv`,{body:csv,type:'text/csv'});
 fake.settings.fileBytes.set(`${work}/shot.png`,{body:png,type:'image/png'});
 fake.settings.fileBytes.set(`${work}/logo.svg`,{body:svg,type:'image/svg+xml'});
 query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id) values ('${agent}','${company}');
   insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${agent}','${company}','Librarian','Keeps the files.',false,'${profile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${companyProfile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.member_agent_access(company_id,person_id,agent_id) values
    ('${company}','20000000-0000-0000-0000-000000000003','${agent}'),
    ('${company}','20000000-0000-0000-0000-000000000004','${agent}');
  end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

async function openFiles(page:Page,email:string) {
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,email,`/c/rs-learning/chat/${agent}`);
 const details=page.getByRole('complementary',{name:'Details: Librarian',exact:true});
 await expect(details).toBeVisible();
 await details.getByRole('tab',{name:'Files',exact:true}).click();
 const library=details.getByRole('tabpanel').locator('.dp-library');
 await expect(library).toBeVisible();
 return library;
}
const row=(library:ReturnType<Page['locator']>,name:string)=>library.getByRole('button',{name:new RegExp(`^${name.replaceAll('.','\\.')}`)});
const dialog=(page:Page)=>page.locator('dialog.pv');
const closedBack=async(page:Page,library:ReturnType<Page['locator']>,name:string)=>{
 await expect(dialog(page)).toBeHidden();
 await expect(row(library,name)).toBeFocused();
};

test('the Owner opens a file\'s preview with the keyboard on Download, and closes it with the button, Escape and a press on the backdrop',async({page})=>{
 const library=await openFiles(page,'omar@example.com');
 await row(library,'brief.md').click();
 await expect(dialog(page)).toBeVisible();
 await expect(dialog(page).getByRole('heading',{name:'brief.md'})).toBeVisible();
 await expect(dialog(page)).toContainText('Read only. For edits, ask Librarian in the chat.');
 await expect(dialog(page).locator('pre.pv-text')).toHaveText(brief);
 await expect(dialog(page).getByRole('link',{name:'Download',exact:true})).toBeFocused();
 // The close button runs the reference's leave first, then the row has the keyboard.
 await dialog(page).getByRole('button',{name:'Close',exact:true}).click();
 await expect(dialog(page)).toHaveClass(/is-closing/);
 await closedBack(page,library,'brief.md');
 // Escape.
 await row(library,'brief.md').click();
 await expect(dialog(page).getByRole('link',{name:'Download',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');
 await closedBack(page,library,'brief.md');
 // A press on the backdrop, the part of the window the centred dialog does not cover.
 await row(library,'brief.md').click();
 await expect(dialog(page)).toBeVisible();
 await page.mouse.click(10,10);
 await closedBack(page,library,'brief.md');
});

test('a PNG is drawn, an SVG is never drawn, a CSV is a table, and a long file says how big it is',async({page})=>{
 const library=await openFiles(page,'omar@example.com');
 await row(library,'shot.png').click();
 const picture=dialog(page).getByRole('img',{name:'shot.png'});
 await expect(picture).toBeVisible();
 await expect(picture).toHaveAttribute('src',`/c/rs-learning/agent-files/${agent}?name=shot.png`);
 await dialog(page).getByRole('button',{name:'Close',exact:true}).click();
 await expect(dialog(page)).toBeHidden();
 // The vector image shows only its icon and Download: the answer carries no content of it.
 await row(library,'logo.svg').click();
 await expect(dialog(page).locator('.pv-none')).toContainText('logo.svg');
 await expect(dialog(page).locator('img, pre, table')).toHaveCount(0);
 const answer=await page.request.get(`/api/agent-files/preview?company=${company}&agent=${agent}&name=logo.svg`);
 expect(answer.status()).toBe(200);
 expect(await answer.json()).toMatchObject({kind:'none',text:null});
 await dialog(page).getByRole('button',{name:'Close',exact:true}).click();
 await expect(dialog(page)).toBeHidden();
 // The rows of a CSV, its head row included.
 await row(library,'q3.csv').click();
 await expect(dialog(page).locator('table th')).toHaveText(['name','spend']);
 await expect(dialog(page).locator('table tbody tr')).toHaveCount(2);
 await dialog(page).getByRole('button',{name:'Close',exact:true}).click();
 await expect(dialog(page)).toBeHidden();
 // A file over the Engine's 512 KB says so, with the whole size.
 await row(library,'long.txt').click();
 await expect(dialog(page).locator('.pv-more')).toHaveText('This is the first part. The whole file is 600 KB.');
});

test('Download in the dialog saves the row\'s own file, with the toast drawn inside the open dialog',async({page})=>{
 const library=await openFiles(page,'omar@example.com');
 await row(library,'brief.md').click();
 const download=dialog(page).getByRole('link',{name:'Download',exact:true});
 await expect(download).toHaveAttribute('href',`/c/rs-learning/agent-files/${agent}?name=brief.md`);
 await download.click();
 // The reference moves a toast raised while a dialog is open into that dialog, so it stays visible over it.
 await expect(dialog(page).locator('.toast')).toContainText('Downloading “brief.md”');
 const file=await page.request.get((await download.getAttribute('href'))!);
 expect(file.status()).toBe(200);
 expect(file.headers()['content-disposition']).toBe("attachment; filename*=UTF-8''brief.md");
 expect(await file.text()).toBe(brief);
});

test('a Contributor and a Viewer get no content from the read route',async({page})=>{
 for(const email of ['reviewer@example.com','viewer@example.com']) {
  await page.context().clearCookies();
  await page.setViewportSize({width:1440,height:900});
  await signIn(page,email,`/c/rs-learning/chat/${agent}`);
  const details=page.getByRole('complementary',{name:'Details: Librarian',exact:true});
  await expect(details).toBeVisible();
  await details.getByRole('tab',{name:'Files',exact:true}).click();
  await expect(details.getByRole('tabpanel').locator('.dp-library')).toHaveCount(0);
  const answer=await page.request.get(`/api/agent-files/preview?company=${company}&agent=${agent}&name=brief.md`);
  expect(answer.status(),email).toBe(403);
  const outside=await page.request.get(`/api/agent-files/preview?company=${company}&agent=${agent}&folder=..&name=brief.md`);
  expect(outside.status(),email).toBe(403);
 }
});
