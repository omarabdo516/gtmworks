import { test, expect, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

// The board's motion as built (#131; design-reference: dragStart, dragMove, dragScroll, dragEnd, land, boardEnter,
// syncWaitMarks): a carried Card leans with the pointer and scrolls the columns at an edge, flies back when it moves
// nothing, lands where it is dropped, bars grow in, and a Card newly waiting on the reader nudges its badge and pops the
// sidebar's count. The seeded accounts read English.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const rs='10000000-0000-0000-0000-000000000001';
// A Card of this test's own in a stage, at its column's end; with `done`/`open` checklist items it shows a progress bar.
const cardIn=(title:string,stage:string,checklist?:{done:number,open:number})=>{
 const id=Number(rows(`insert into public.work_cards(company_id,stage_id,title) select '${rs}',id,'${title} ${Date.now()}' from public.work_stages where company_id='${rs}' and name='${stage}' returning id`)[0].id);
 if(checklist) query(`insert into public.work_checklist(company_id,card_id,title,done) select '${rs}',${id},'Step '||x,x<=${checklist.done} from generate_series(1,${checklist.done+checklist.open}) x`);
 return id;
};
const card=(page:Page,id:number)=>page.locator(`#board-cols .kcard[data-card-id="${id}"]`);
const columnOf=(page:Page,id:number)=>card(page,id).evaluate(el=>el.closest('[data-column]')?.getAttribute('data-column')??null);
const ghost=(page:Page)=>page.locator('.kcard--ghost');
// The carried Card's lean in degrees and its scale, read from its computed transform; null when it has none.
const lean=(page:Page)=>ghost(page).evaluate(el=>{ const value=getComputedStyle(el).transform; if(value==='none') return null; const m=new DOMMatrixReadOnly(value); return {angle:Math.atan2(m.b,m.a)*180/Math.PI,scale:Math.hypot(m.a,m.b)}; });
// The carried Card's lean on each of the next 20 frames, while the pointer moves: the extremes are the lean it took.
const leans=(page:Page)=>page.evaluate(()=>new Promise<number[]>(done=>{ const seen:number[]=[]; const read=()=>{ const el=document.querySelector('.kcard--ghost'); if(el) { const m=new DOMMatrixReadOnly(getComputedStyle(el).transform); seen.push(Math.atan2(m.b,m.a)*180/Math.PI); } if(seen.length>=20) done(seen); else requestAnimationFrame(read); }; requestAnimationFrame(read); }));
// Picks a Card up with the mouse and carries it a few pixels, so the board treats it as carried.
async function pickUp(page:Page,id:number) {
 await card(page,id).scrollIntoViewIfNeeded();
 const box=(await card(page,id).boundingBox())!;
 const at={x:box.x+box.width/2,y:box.y+20};
 await page.mouse.move(at.x,at.y); await page.mouse.down(); await page.mouse.move(at.x+8,at.y,{steps:2});
 await expect(ghost(page)).toHaveCount(1);
 return at;
}
const logRows=(id:number)=>Number(rows(`select count(*) n from public.work_activity where card_id=${id}`)[0].n);

test('a carried Card leans with the pointer and settles back, scrolls the columns at an edge, and has no lean with reduced motion',async({page})=>{
 const id=cardIn('Lean','أفكار');
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await page.setViewportSize({width:1280,height:800});
 const at=await pickUp(page,id);
 // Standing still, it rests at 2deg and 1.03.
 await expect.poll(async()=>(await lean(page))?.angle).toBeCloseTo(2,1);
 expect((await lean(page))!.scale).toBeCloseTo(1.03,2);
 // Carried fast to the right, it leans further that way, never past 8deg; standing still again, it comes back to 2deg.
 const right=leans(page); await page.mouse.move(at.x+160,at.y,{steps:4});
 const fast=Math.max(...await right);
 expect(fast).toBeGreaterThan(2.5); expect(fast).toBeLessThanOrEqual(8);
 await expect.poll(async()=>(await lean(page))?.angle).toBeCloseTo(2,1);
 // Fast to the left, it leans the other way, never under -4deg.
 const left=leans(page); await page.mouse.move(at.x-60,at.y,{steps:4});
 const back=Math.min(...await left);
 expect(back).toBeLessThan(1.5); expect(back).toBeGreaterThanOrEqual(-4);
 await expect.poll(async()=>(await lean(page))?.angle).toBeCloseTo(2,1);
 // Held within 72px of the board's right edge, the columns scroll 12px a frame.
 const board=(await page.locator('#board-cols').boundingBox())!;
 await page.mouse.move(board.x+board.width-30,at.y,{steps:4});
 const moved=await page.locator('#board-cols').evaluate(async el=>{
  const frame=()=>new Promise(done=>requestAnimationFrame(done));
  await frame(); const start=el.scrollLeft; for(let n=0;n<10;n++) await frame(); return {by:el.scrollLeft-start,room:el.scrollWidth-el.clientWidth-start};
 });
 expect(moved.room).toBeGreaterThan(0);
 expect(moved.by).toBeGreaterThanOrEqual(Math.min(moved.room,12*8)); expect(moved.by).toBeLessThanOrEqual(12*12);
 await page.keyboard.press('Escape');
 await page.mouse.up();
 await expect(ghost(page)).toHaveCount(0);
 // With reduced motion the carried Card neither leans nor grows, moved fast or not.
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.reload();
 const still=await pickUp(page,id);
 await page.mouse.move(still.x+160,still.y,{steps:2});
 expect(await lean(page)).toBeNull();
 await page.keyboard.press('Escape');
 await page.mouse.up();
 expect(await columnOf(page,id)).toBe('ideas');
});

// Watches the carried Card from the page itself, so a slow runner cannot miss a flight of 230ms: from the next key press
// or mouse release, two frames later it reads the copy's transition and whether the Card's place is dimmed, then times
// how long the copy stays in the page. Started before the press; `flight` reads what it saw.
const watchFlight=(page:Page,id:number)=>page.evaluate(id=>{
 (window as unknown as {flight:Promise<unknown>}).flight=new Promise(done=>{
  const start=()=>{ window.removeEventListener('keydown',start,true); window.removeEventListener('mouseup',start,true); const at=performance.now();
   const frame=()=>new Promise(next=>requestAnimationFrame(next));
   void frame().then(frame).then(()=>{
    const copy=document.querySelector<HTMLElement>('.kcard--ghost'); const style=copy&&getComputedStyle(copy);
    const seen={transition:style?{property:style.transitionProperty,duration:style.transitionDuration,easing:style.transitionTimingFunction}:null,dimmed:!!document.querySelector(`#board-cols .kcard[data-card-id="${id}"]`)?.classList.contains('is-drag-src')};
    const gone=()=>{ if(document.querySelector('.kcard--ghost')) { requestAnimationFrame(gone); return; } done({...seen,ms:Math.round(performance.now()-at),dimmedAfter:!!document.querySelector(`#board-cols .kcard[data-card-id="${id}"]`)?.classList.contains('is-drag-src')}); };
    gone();
   });
  };
  window.addEventListener('keydown',start,true); window.addEventListener('mouseup',start,true);
 });
},id);
const flight=(page:Page)=>page.evaluate(()=>(window as unknown as {flight:Promise<{transition:{property:string,duration:string,easing:string}|null,dimmed:boolean,ms:number,dimmedAfter:boolean}>}).flight);

test('a Card cancelled with Escape or let go on its own place flies back over 220ms, dimmed in its place until it arrives, and moves nothing',async({page})=>{
 const id=cardIn('Fly back','أفكار');
 const logged=logRows(id);
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const flying={transition:{property:'transform',duration:'0.22s',easing:'cubic-bezier(0.2, 0, 0, 1)'},dimmed:true};
 const at=await pickUp(page,id);
 await page.mouse.move(at.x+200,at.y+40,{steps:6});
 // Escape: still in the page, on its way back with the reference's transition, its place dimmed until it arrives.
 await watchFlight(page,id);
 await page.keyboard.press('Escape');
 const cancelled=await flight(page);
 expect(cancelled).toMatchObject(flying);
 expect(cancelled.ms).toBeGreaterThanOrEqual(200);
 await page.mouse.up();
 await expect(card(page,id)).not.toHaveClass(/is-drag-src/);
 // Let go where it already stands: it flies back the same way.
 const again=await pickUp(page,id);
 await page.mouse.move(again.x+4,again.y+2,{steps:2});
 await watchFlight(page,id);
 await page.mouse.up();
 const dropped=await flight(page);
 expect(dropped).toMatchObject(flying);
 expect(dropped.ms).toBeGreaterThanOrEqual(200);
 await expect(card(page,id)).not.toHaveClass(/is-drag-src/);
 // With reduced motion it is gone in the next frame.
 await page.emulateMedia({reducedMotion:'reduce'});
 const still=await pickUp(page,id);
 await page.mouse.move(still.x+200,still.y+40,{steps:6});
 await watchFlight(page,id);
 await page.keyboard.press('Escape');
 expect(await flight(page)).toMatchObject({transition:null,dimmed:false});
 await page.mouse.up();
 await page.reload();
 expect(await columnOf(page,id)).toBe('ideas');
 expect(logRows(id)).toBe(logged);
});

test('a Card dropped in another column or moved with Shift and an arrow lands on a spring with a ring, and a Viewer picks nothing up',async({page,browser})=>{
 const id=cardIn('Landing','أفكار');
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 // Watches the Card in its new column for the landing's inline transition and ring.
 const landing=()=>page.evaluate(({id})=>new Promise<{transition:string,ring:boolean,transform:string}>(done=>{
  const seen=()=>{ const el=document.querySelector<HTMLElement>(`#board-cols [data-column="planned"] .kcard[data-card-id="${id}"]`); if(el?.classList.contains('is-landing')) { done({transition:el.style.transition,ring:true,transform:el.style.transform}); return true; } return false; };
  if(seen()) return; const watch=new MutationObserver(()=>{ if(seen()) watch.disconnect(); }); watch.observe(document.body,{subtree:true,attributes:true,childList:true});
 }),{id});
 const at=await pickUp(page,id);
 const planned=(await page.locator('#board-cols .col[data-column="planned"] .col__body').boundingBox())!;
 const landed=landing();
 await page.mouse.move(planned.x+planned.width/2,planned.y+planned.height-6,{steps:12});
 await page.mouse.up();
 expect(await landed).toMatchObject({transition:'transform 320ms var(--gw-ease-spring)',ring:true});
 expect(await card(page,id).evaluate(el=>getComputedStyle(el).transitionTimingFunction)).toBe('cubic-bezier(0.34, 1.45, 0.64, 1)');
 void at;
 await page.waitForTimeout(400);
 await expect(card(page,id)).not.toHaveClass(/is-landing/);
 expect(await card(page,id).evaluate(el=>el.style.transition)).toBe('');
 // Back with Shift and an arrow: it drops in from 6px above, in Ideas.
 await page.locator(`#board-cols .kcard[data-card-id="${id}"] a`).focus();
 const keyed=page.evaluate(({id})=>new Promise<{transition:string}>(done=>{
  const watch=new MutationObserver(()=>{ const el=document.querySelector<HTMLElement>(`#board-cols [data-column="ideas"] .kcard[data-card-id="${id}"]`); if(el?.classList.contains('is-landing')) { watch.disconnect(); done({transition:el.style.transition}); } });
  watch.observe(document.body,{subtree:true,attributes:true,childList:true});
 }),{id});
 await page.keyboard.press('Shift+ArrowLeft');
 expect(await keyed).toEqual({transition:'transform 320ms var(--gw-ease-spring)'});
 await page.waitForTimeout(400);
 await expect(card(page,id)).not.toHaveClass(/is-landing/);
 // With reduced motion there is no landing.
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator(`#board-cols .kcard[data-card-id="${id}"] a`).focus();
 await page.keyboard.press('Shift+ArrowRight');
 await expect.poll(()=>columnOf(page,id)).toBe('planned');
 await expect(card(page,id)).not.toHaveClass(/is-landing/);
 // A Viewer's pointer picks nothing up.
 const viewer=await browser.newPage();
 try {
  await signIn(viewer,'viewer@example.com','/c/rs-learning/work/board');
  const box=(await card(viewer,id).boundingBox())!;
  await viewer.mouse.move(box.x+box.width/2,box.y+20); await viewer.mouse.down(); await viewer.mouse.move(box.x+box.width/2+120,box.y+60,{steps:8});
  await expect(ghost(viewer)).toHaveCount(0);
  await viewer.mouse.up();
 } finally { await viewer.close(); }
});

test('a Card carried until its own place is out of the window and dropped in another column leaves the board where it is (#556)',async({page})=>{
 const id=cardIn('Far drop','أفكار');
 await page.setViewportSize({width:900,height:800});
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const at=await pickUp(page,id);
 await page.mouse.move(at.x+40,at.y,{steps:2});
 // The columns scrolled while it is carried until its place in Ideas is off the window's left edge, where dnd-kit
 // would bring it back into view before a drop animation; In progress is then in the board's view.
 const board=page.locator('#board-cols');
 await board.evaluate((el,id)=>{ el.style.scrollSnapType='none'; /* held where it is put */ el.scrollLeft+=el.querySelector(`.kcard[data-card-id="${id}"]`)!.getBoundingClientRect().right+16; },id);
 await expect.poll(()=>card(page,id).evaluate(el=>el.getBoundingClientRect().right)).toBeLessThan(0);
 const body=(await page.locator('#board-cols > .col[data-column="progress"] .col__body').boundingBox())!;
 const view=(await board.boundingBox())!;
 expect(body.x).toBeGreaterThanOrEqual(view.x); expect(body.x+body.width).toBeLessThanOrEqual(view.x+view.width);
 await page.mouse.move(body.x+body.width/2,body.y+body.height/2,{steps:6});
 // From the release until the Card is drawn in its new column and has landed, the board never scrolls back.
 const scrolls=board.evaluate((el,id)=>new Promise<{atDrop:number,least:number}>(done=>{
  window.addEventListener('mouseup',()=>{ const atDrop=el.scrollLeft; let least=atDrop; const since=performance.now();
   const read=()=>{ least=Math.min(least,el.scrollLeft); const there=el.querySelector(`[data-column="progress"] .kcard[data-card-id="${id}"]`);
    if(there&&performance.now()-since>500) done({atDrop,least}); else requestAnimationFrame(read); };
   read();
  },{capture:true,once:true});
 }),id);
 await page.waitForTimeout(50);
 await page.mouse.up();
 const seen=await scrolls;
 expect(seen.least).toBeGreaterThanOrEqual(seen.atDrop-1);
 await page.reload();
 expect(await columnOf(page,id)).toBe('progress');
});

test('the progress bars grow in when the board opens and the class that does it is gone after a second, leaving the edge fade; with reduced motion they are drawn at their value',async({page})=>{
 const id=cardIn('Bar','كتابة',{done:1,open:1});
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await page.reload();
 const bar=card(page,id).locator('.bar__fill');
 expect(await bar.evaluate(el=>{ const style=getComputedStyle(el); return {name:style.animationName,duration:style.animationDuration,fill:style.animationFillMode,transition:style.transition}; }))
  .toEqual({name:'gw-bar-grow',duration:'0.7s',fill:'both',transition:'transform 0.28s cubic-bezier(0.2, 0, 0, 1)'});
 // More columns wait past the board's edge, so it fades there (BoardPager). The fade is the pager's, and taking the
 // entrance class off must leave it (#572: React drew the board's class again and wiped it).
 await expect(page.locator('#board-cols')).toHaveClass(/\bhas-more-end\b/);
 await page.waitForTimeout(1000);
 await expect(page.locator('#board-cols.board--enter')).toHaveCount(0);
 expect(await bar.evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 await expect(page.locator('#board-cols')).toHaveClass(/\bhas-more-end\b/);
 expect(await page.locator('#board-cols').evaluate(el=>getComputedStyle(el).maskImage)).toContain('linear-gradient');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.reload();
 expect(await bar.evaluate(el=>({name:getComputedStyle(el).animationName,transform:getComputedStyle(el).transform}))).toEqual({name:'none',transform:'matrix(0.5, 0, 0, 1, 0, 0)'});
});

test('a Card newly waiting on the approver nudges its badge and pops the sidebar count once, not on a reload and not when the count falls',async({page,context})=>{
 // The board stays open in one tab while the approver moves a Card to review on its own page in another; the board is
 // drawn again when the reader next moves a Card there.
 const mover=cardIn('Redraw','أفكار');
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const redraw=async(to:'ArrowRight'|'ArrowLeft')=>{ const column=await columnOf(page,mover); await page.locator(`#board-cols .kcard[data-card-id="${mover}"] a`).focus(); await page.keyboard.press(`Shift+${to}`); await expect.poll(()=>columnOf(page,mover)).not.toBe(column); };
 const tab=await context.newPage();
 await tab.goto('/c/rs-learning/work/new');
 await tab.getByLabel('Message',{exact:true}).fill(`Nudge ${Date.now()}`);
 await tab.getByRole('button',{name:'Create card'}).click();
 await expect(tab).toHaveURL(/\/work\/board\/\d+$/);
 const id=Number(new URL(tab.url()).pathname.split('/').pop());
 await tab.getByLabel('New design file').setInputFiles({name:'design.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=','base64')});
 await tab.getByRole('button',{name:'Add design'}).click();
 await expect(tab.getByText(/Version 1:/)).toBeVisible();
 await page.reload();
 const count=page.locator('.sb-count');
 const before=Number(await count.textContent());
 await tab.getByLabel('Move to list',{exact:true}).selectOption({label:'مراجعة'});
 await expect(tab.locator('.card-stage-line')).toContainText('مراجعة');
 await redraw('ArrowRight');
 const badge=page.locator(`#board-cols .kcard[data-card-id="${id}"] .badge--wait`);
 await expect(badge).toHaveClass(/is-new/);
 expect(await badge.evaluate(el=>({name:getComputedStyle(el).animationName,duration:getComputedStyle(el).animationDuration,easing:getComputedStyle(el).animationTimingFunction}))).toEqual({name:'gw-nudge',duration:'0.52s',easing:'cubic-bezier(0.2, 0, 0, 1)'});
 await expect(count).toHaveText(String(before+1));
 await expect(count).toHaveClass(/is-pop/);
 expect(await count.evaluate(el=>({name:getComputedStyle(el).animationName,duration:getComputedStyle(el).animationDuration,easing:getComputedStyle(el).animationTimingFunction}))).toEqual({name:'gw-count-pop',duration:'0.36s',easing:'cubic-bezier(0.34, 1.45, 0.64, 1)'});
 // A reload shows neither.
 await page.reload();
 await expect(badge).toBeVisible();
 await expect(badge).not.toHaveClass(/is-new/);
 await expect(count).not.toHaveClass(/is-pop/);
 // Approving it: the count falls when the board is drawn again, and neither plays.
 await tab.reload();
 await tab.locator('[data-card-section="review"]').getByRole('button',{name:'Approve',exact:true}).click();
 await expect(tab.locator('.card-stage-line')).not.toContainText('مراجعة');
 await redraw('ArrowLeft');
 await expect(count).toHaveText(String(before));
 await expect(count).not.toHaveClass(/is-pop/);
 await expect(page.locator('#board-cols .badge--wait.is-new')).toHaveCount(0);
});
