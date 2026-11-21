import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import type { ComponentProps } from 'react';
import { LanguageProvider } from '@/lib/i18n-client';
import { AgentMorning, type MorningProps } from '@/app/settings-agent-morning';
import { AgentSaveBar } from '@/app/settings-agent-form';
import { ToastHost } from '@/app/toast';
import en from '@/lib/messages/en.json';
import ar from '@/lib/messages/ar.json';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))}/> }));

// #182: Good morning on the main Agent's page. The switch and the time are two keys of the page's draft and join its save
// bar as one `morning` part; the time select is disabled while the switch is off in the draft; below Agent level 3 the
// switch cannot be turned on and one line says why; a Contributor and a Viewer read one row.
const company='10000000-0000-0000-0000-000000000001';
const off:MorningProps={made:false,on:false,time:null,expr:null,display:null,timezone:null,allowed:true,quietYesterday:false};
let count=0;
const morningPage=(morning:MorningProps|null=off,editable=true,language:'en'|'ar'='en')=>{
 const agent=`ag-morning-${++count}`;
 return render(<LanguageProvider language={language}>
  <ToastHost />
  <div className="gw"><div className="sov"><div id="sov-agent-panel"><AgentMorning agent={agent} editable={editable} morning={morning}/></div>
  <AgentSaveBar company={company} agent={agent} name="Lead"/></div></div>
 </LanguageProvider>);
};
const answer=(body:object)=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
const select=()=>document.getElementById('set-ck-time') as HTMLSelectElement;
afterEach(()=>{ vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('the reference\'s switch, time and hint; the select offers every half hour from 7:00 to 11:00 and is disabled while the switch is off',async()=>{
 const screen=await morningPage();
 await expect.element(screen.getByRole('switch',{name:en.settingsCheckin})).toHaveAttribute('aria-checked','false');
 await expect.poll(()=>select()?.disabled).toBe(true);
 expect([...select().options].map(option=>option.textContent)).toEqual(['7:00 AM','7:30 AM','8:00 AM','8:30 AM','9:00 AM','9:30 AM','10:00 AM','10:30 AM','11:00 AM']);
 expect(select().value).toBe('9:00');
 expect(document.getElementById('set-ck-hint')?.textContent).toBe(en.settingsCheckinHint);
 expect(document.getElementById('set-ck-level')).toBeNull();
 await screen.getByRole('switch',{name:en.settingsCheckin}).click();
 await expect.element(screen.getByRole('switch',{name:en.settingsCheckin})).toHaveAttribute('aria-checked','true');
 await expect.poll(()=>select().disabled).toBe(false);
 await screen.getByRole('switch',{name:en.settingsCheckin}).click();
 await expect.poll(()=>select().disabled).toBe(true);
});

test('the switch and the time join the save bar and go in one request as one part, with the browser\'s zone',async()=>{
 const sent:{url:string,body:{changes:Record<string,unknown>}}[]=[];
 vi.stubGlobal('fetch',(url:string,init:RequestInit)=>{
  const body=JSON.parse(String(init.body)) as {changes:{morning:{on:boolean,time:string}}};
  sent.push({url,body});
  return Promise.resolve(answer({saved:{morning:{on:body.changes.morning.on,time:body.changes.morning.time}}}));
 });
 const screen=await morningPage();
 const bar=document.getElementById('dp-savebar')!;
 expect(bar.hidden).toBe(true);
 await screen.getByRole('switch',{name:en.settingsCheckin}).click();
 await expect.poll(()=>bar.hidden).toBe(false);
 await screen.getByRole('combobox',{name:en.settingsCheckinTime}).selectOptions('10:30');
 await screen.getByRole('button',{name:'Save',exact:true}).click();
 await expect.poll(()=>sent.length).toBe(1);
 expect(sent[0].url).toBe('/api/agent-page');
 expect(sent[0].body.changes).toEqual({morning:{on:true,time:'10:30',zone:Intl.DateTimeFormat().resolvedOptions().timeZone}});
 await expect.poll(()=>document.getElementById('dp-savebar')?.hidden).toBe(true);
 // Cancel puts the saved switch back, and with it the disabled select.
 await screen.getByRole('switch',{name:en.settingsCheckin}).click();
 await expect.poll(()=>bar.hidden).toBe(false);
 await screen.getByRole('button',{name:en.settingsCancel,exact:true}).click();
 await expect.element(screen.getByRole('switch',{name:en.settingsCheckin})).toHaveAttribute('aria-checked','true');
 await expect.poll(()=>bar.hidden).toBe(true);
});

test('the job\'s own zone names the time, a time changed in a chat is shown as it is, and the quiet day is said',async()=>{
 await morningPage({made:true,on:true,time:'6:15',expr:'15 6 * * *',display:null,timezone:'Africa/Cairo',allowed:true,quietYesterday:true});
 await expect.poll(()=>document.getElementById('set-ck-zone')?.textContent).toBe('Cairo time');
 expect(select().value).toBe('6:15');
 expect(select().options[0].textContent).toBe('6:15 AM');
 expect(document.getElementById('set-ck-hint')?.textContent).toBe(`${en.settingsCheckinHint} ${en.settingsCheckinQuiet}`);
});

test('in Arabic the reference\'s words and the zone\'s city',async()=>{
 const screen=await morningPage({made:true,on:true,time:'9:00',expr:'0 9 * * *',display:null,timezone:'Africa/Cairo',allowed:true,quietYesterday:false},true,'ar');
 await expect.element(screen.getByRole('switch',{name:ar.settingsCheckin})).toHaveAttribute('aria-checked','true');
 await expect.poll(()=>document.getElementById('set-ck-zone')?.textContent).toBe('بتوقيت القاهرة');
 expect(select().selectedOptions[0].textContent).toBe('9:00 الصبح');
});

test('below Agent level 3 the switch cannot be turned on and one line says why',async()=>{
 const screen=await morningPage({...off,allowed:false});
 await expect.poll(()=>document.getElementById('set-ck-level')?.textContent).toBe(en.settingsCheckinLevel);
 const control=screen.getByRole('switch',{name:en.settingsCheckin});
 await expect.element(control).toHaveAttribute('aria-disabled','true');
 // Playwright will not press a control marked disabled, so it is pressed as a script would.
 (control.element() as HTMLElement).click();
 await expect.element(control).toHaveAttribute('aria-checked','false');
 expect(document.getElementById('dp-savebar')?.hidden).toBe(true);
});

test('a Contributor and a Viewer read one row: Every day at the time, or Off',async()=>{
 const on=await morningPage({made:true,on:true,time:'9:00',expr:'0 9 * * *',display:null,timezone:'Africa/Cairo',allowed:true,quietYesterday:false},false);
 await expect.poll(()=>document.getElementById('set-ck-val')?.textContent).toBe('Every day at 9:00 AM');
 expect(document.querySelector('[role=switch]')).toBeNull();
 expect(document.getElementById('set-ck-time')).toBeNull();
 await on.unmount();
 await morningPage(off,false);
 await expect.poll(()=>document.getElementById('set-ck-val')?.textContent).toBe(en.settingsCheckinOff);
});

test('a save refused below Agent level 3 says why in the bar, not only that it failed',async()=>{
 vi.stubGlobal('fetch',()=>Promise.resolve(new Response(JSON.stringify({error:'agentPageLevelLow'}),{status:409,headers:{'Content-Type':'application/json'}})));
 const screen=await morningPage();
 await screen.getByRole('switch',{name:en.settingsCheckin}).click();
 await screen.getByRole('button',{name:'Save',exact:true}).click();
 await expect.poll(()=>document.querySelector('#dp-savebar .set-err')?.textContent).toBe(en.settingsCheckinLevel);
});

test('a schedule set in a chat that is no daily time is offered as it is, and kept',async()=>{
 await morningPage({made:true,on:true,time:null,expr:null,display:'every 720m',timezone:'Africa/Cairo',allowed:true,quietYesterday:false});
 await expect.poll(()=>select()?.value).toBe('keep');
 expect(select().options[0].textContent).toBe('every 720m');
});
