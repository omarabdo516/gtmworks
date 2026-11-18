import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { LanguageProvider } from '@/lib/i18n-client';
import { AgentEffort } from '@/app/settings-agent-effort';
import { AgentSaveBar } from '@/app/settings-agent-form';
import { ToastHost } from '@/app/toast';
import en from '@/lib/messages/en.json';
import ar from '@/lib/messages/ar.json';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

// #179: an Agent's thinking level is the Engine's eight levels and no other, in its own order. The four the reference
// words carry its line under the control and the other four no line; the arrow keys move the choice forward, left in
// Arabic and right in English; only the Owner gets the control, every other Role reads the level as text; the choice is
// one key of the page's draft and goes in the Save bar's request.
const company='10000000-0000-0000-0000-000000000001';
let count=0;
const effortPage=(effort:string|null='medium',editable=true,language:'en'|'ar'='en')=>{
 const agent=`ag-effort-${++count}`;
 return render(<LanguageProvider language={language}>
  <ToastHost />
  <div id="sov-agent-panel"><AgentEffort agent={agent} effort={effort} editable={editable}/></div>
  <AgentSaveBar company={company} agent={agent} name="Lead"/>
 </LanguageProvider>);
};
const answer=(body:object)=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
afterEach(()=>{ vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('the control lists the Engine\'s eight levels and no other, the reference\'s words for the four it words',async()=>{
 const screen=await effortPage();
 const radios=screen.getByRole('radio');
 await expect.poll(()=>document.querySelectorAll('[role=radio]').length).toBe(8);
 for(const [index,label] of [en.settingsEffortNone,en.settingsEffortMinimal,en.settingsEffortLow,en.settingsEffortMedium,en.settingsEffortHigh,en.settingsEffortXhigh,en.settingsEffortMax,en.settingsEffortUltra].entries())
  await expect.element(radios.nth(index)).toHaveTextContent(label);
 await expect.element(screen.getByRole('radio',{name:en.settingsEffortMedium})).toHaveAttribute('aria-checked','true');
 await expect.poll(()=>document.getElementById('set-effort-hint')?.textContent).toBe(en.settingsEffortMediumHint);
});

test('the line follows the chosen level for the four the reference words; the other four have none',async()=>{
 const screen=await effortPage();
 const hint=()=>document.getElementById('set-effort-hint')?.textContent??'';
 for(const [label,line] of [[en.settingsEffortLow,en.settingsEffortLowHint],[en.settingsEffortHigh,en.settingsEffortHighHint],[en.settingsEffortMax,en.settingsEffortMaxHint],[en.settingsEffortMedium,en.settingsEffortMediumHint]]) {
  await screen.getByRole('radio',{name:label}).click();
  await expect.poll(hint).toBe(line);
  await expect.element(screen.getByRole('radio',{name:label})).toHaveAttribute('aria-checked','true');
 }
 for(const label of [en.settingsEffortNone,en.settingsEffortMinimal,en.settingsEffortXhigh,en.settingsEffortUltra]) {
  await screen.getByRole('radio',{name:label}).click();
  await expect.poll(hint).toBe('');
  await expect.element(screen.getByRole('radio',{name:label})).toHaveAttribute('aria-checked','true');
 }
});

test('the arrow keys move the choice forward: left in Arabic, right in English',async()=>{
 const arabic=await effortPage('medium',true,'ar');
 await arabic.getByRole('radio',{name:ar.settingsEffortMedium}).click();
 await userEvent.keyboard('{ArrowLeft}');
 await expect.element(arabic.getByRole('radio',{name:ar.settingsEffortHigh})).toHaveAttribute('aria-checked','true');
 await expect.element(arabic.getByRole('radio',{name:ar.settingsEffortHigh})).toHaveFocus();
 await expect.poll(()=>document.getElementById('set-effort-hint')?.textContent).toBe(ar.settingsEffortHighHint);
 await userEvent.keyboard('{ArrowRight}');
 await expect.element(arabic.getByRole('radio',{name:ar.settingsEffortMedium})).toHaveAttribute('aria-checked','true');
 await arabic.unmount();
 const english=await effortPage('medium',true,'en');
 await english.getByRole('radio',{name:en.settingsEffortMedium}).click();
 await userEvent.keyboard('{ArrowRight}');
 await expect.element(english.getByRole('radio',{name:en.settingsEffortHigh})).toHaveAttribute('aria-checked','true');
 await expect.element(english.getByRole('radio',{name:en.settingsEffortHigh})).toHaveFocus();
 // The first and last levels are where the arrow stops.
 await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
 await expect.element(english.getByRole('radio',{name:en.settingsEffortUltra})).toHaveAttribute('aria-checked','true');
});

test('a Manager, a Contributor and a Viewer read the level as text with no control',async()=>{
 await effortPage('high',false);
 expect(document.querySelectorAll('[role=radio]')).toHaveLength(0);
 await expect.poll(()=>document.getElementById('set-effort-val')?.textContent).toBe(en.settingsEffortHigh);
});

test('the chosen level joins the page draft and is saved with the bar in one request',async()=>{
 const sent:{url:string,body:{changes:Record<string,unknown>}}[]=[];
 vi.stubGlobal('fetch',(url:string,init:RequestInit)=>{
  const body=JSON.parse(String(init.body)) as {changes:Record<string,unknown>};
  sent.push({url,body});
  return Promise.resolve(answer({saved:{effort:body.changes.effort}}));
 });
 const screen=await effortPage('medium');
 const bar=document.getElementById('dp-savebar')!;
 expect(bar.hidden).toBe(true);
 await screen.getByRole('radio',{name:en.settingsEffortHigh}).click();
 await expect.poll(()=>bar.hidden).toBe(false);
 await screen.getByRole('button',{name:'Save',exact:true}).click();
 await expect.poll(()=>sent.length).toBe(1);
 expect(sent[0].url).toBe('/api/agent-page');
 expect(sent[0].body.changes).toEqual({effort:'high'});
 await expect.poll(()=>document.getElementById('dp-savebar')?.hidden).toBe(true);
 await expect.poll(()=>document.getElementById('set-effort-hint')?.textContent).toBe(en.settingsEffortHighHint);
});
