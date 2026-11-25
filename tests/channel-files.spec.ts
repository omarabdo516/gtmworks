import { test, expect, freshSeed } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

// #156: an image goes with a channel message, shows as a chip under it for the writer and for every other Member, and
// opens only for a Member of that channel. A file the Agent cannot read is refused with the same line as a
// Conversation's (#155), and nothing is posted.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=<T>(sql:string):T[]=>JSON.parse(query(sql)) as T[];
const company='10000000-0000-0000-0000-000000000001';
const channel='69000000-0000-0000-0000-000000000001';
const general=`/c/rs-learning/channels/${channel}`;
// A one-pixel PNG: the Engine is given the bytes and the type the browser names.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const image={name:'cover.png',mimeType:'image/png',buffer:png};
const channelFiles=()=>rows<{n:number}>(`select count(*)::int as n from public.channel_attachments where company_id='${company}'`)[0].n;
const storedChannelFiles=()=>rows<{n:number}>(`select count(*)::int as n from storage.objects where bucket_id='creatives' and name like '${company}/channels/%'`)[0].n;

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{ freshSeed(testInfo); });

test('an image with a channel message shows under it for the writer and for the Viewer, and its file opens for both',async({page})=>{
 await signIn(page,'reviewer@example.com',general);
 const composer=page.locator('.composer');
 // A Contributor may attach in the channel.
 await expect(composer.locator('input[type=file]')).toHaveCount(1);
 await composer.locator('input[type=file]').setInputFiles(image);
 await expect(composer.locator('.composer__files .file-chip')).toHaveText(/cover\.png/);
 const send=page.getByRole('button',{name:'Send',exact:true});
 await expect(send).toBeEnabled();
 await send.click();
 const turn=page.locator('.turn--user').filter({has:page.locator('.msg-files')}).last();
 await expect(turn.locator('.msg-files .file-chip')).toHaveText(/cover\.png/);
 // An image alone shows no bubble.
 await expect(turn.locator('.bubble--user')).toHaveCount(0);
 await expect(composer.locator('.composer__files .file-chip')).toHaveCount(0);
 const href=await turn.locator('.msg-files a.file-chip').getAttribute('href');
 expect(href).toMatch(new RegExp(`^/c/rs-learning/files/channel/\\d+$`));
 // Its own writer opens it, with the headers every attachment leaves with.
 const own=await page.request.get(href!);
 expect(own.status()).toBe(200);
 expect(own.headers()['content-type']).toBe('image/png');
 expect(own.headers()['content-disposition']).toMatch(/^inline;/);
 expect([channelFiles(),storedChannelFiles()].every(count=>count>0)).toBe(true);
 await page.reload();
 await expect(page.locator('.turn--user .msg-files a.file-chip').last()).toHaveAttribute('href',href!);
 // The Viewer reads the chip on the start side, and opens the file; they have no composer to attach one.
 await page.context().clearCookies();
 await signIn(page,'viewer@example.com',general);
 const peer=page.locator('.turn--peer').filter({has:page.locator('.msg-files')}).last();
 await expect(peer.locator('.msg-files .file-chip')).toHaveText(/cover\.png/);
 await expect(page.locator('.composer')).toHaveCount(0);
 const read=await page.request.get(href!);
 expect(read.status()).toBe(200);
 expect(read.headers()['content-type']).toBe('image/png');
 // A visitor with no sign-in finds nothing.
 await page.context().clearCookies();
 expect((await page.request.get(href!)).status()).toBe(404);
});

test('a file the Agent cannot read is refused in the channel with the same line, and nothing is posted',async({page})=>{
 await signIn(page,'reviewer@example.com',general);
 const [files,stored,messages]=[channelFiles(),storedChannelFiles(),rows<{n:number}>(`select count(*)::int as n from public.channel_messages`)[0].n];
 await page.locator('.composer input[type=file]').setInputFiles({name:'brief.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 a page')});
 await expect(page.locator('.composer .composer-error')).toHaveText('The agent can’t read that kind of file yet. Attach a PNG, JPEG, GIF or WebP image.');
 await expect(page.locator('.composer .composer__files .file-chip')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
 // The same refusal on the server, before anything is stored or posted.
 const answer=await page.request.post('/api/channels',{multipart:{company,channel,sendKey:randomUUID(),message:'',files:{name:'brief.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 a page')}}});
 expect(answer.status()).toBe(400);
 expect(await answer.json()).toEqual({error:'attachTypeRefused'});
 expect(channelFiles()).toBe(files);
 expect(storedChannelFiles()).toBe(stored);
 expect(rows<{n:number}>(`select count(*)::int as n from public.channel_messages`)[0].n).toBe(messages);
});
