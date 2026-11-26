import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { PartsReader, partUrl, useSettingsPart } from '@/app/settings-part-read';
import { LanguageProvider } from '@/lib/i18n-client';

// #898: a part's kept read belongs to the signed-in reader who asked for it. Another person who signs in in the same tab
// never sees it: not from the part still on screen, not from a read asked for the first person that lands after the
// change, and not from the browser's kept copy afterwards.
afterEach(() => { vi.unstubAllGlobals(); });

function Part({url}:{url:string}) {
 const read=useSettingsPart<{who:string}>(url,1,data=>typeof data?.who==='string');
 return <><p data-testid="shown">{read.data?.who??'nothing'}</p><p data-testid="state">{read.state}</p></>;
}
// Each read answers when the test lets it, with the reader it is told; one no longer wanted ends as fetch ends it,
// except the first when `late`: it ignores being stopped and still answers, as a response already on its way does.
function held({late=false}:{late?:boolean}={}) {
 const waiting:((who:string)=>void)[]=[];
 vi.stubGlobal('fetch',(_url:string,init?:RequestInit)=>new Promise<Response>((resolve,reject)=>{
  if(!(late&&waiting.length===0)) init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));
  waiting.push(who=>resolve(new Response(JSON.stringify({data:{who},readAt:Date.now()}),{status:200})));
 }));
 return waiting;
}
// The overlay names its reader before any part draws (app/settings-overlay.tsx).
const draw=(person:string,url:string,mount='first')=><LanguageProvider language="en"><PartsReader person={person}/><Part key={mount} url={url}/></LanguageProvider>;

test('a read asked for one reader that lands after another signs in is never shown to the new one, nor kept for them',async()=>{
 const url=partUrl('co-reader-switch','about',{agent:'a'});
 const answers=held({late:true});
 const screen=await render(draw('person-a',url));
 await expect.poll(()=>answers.length).toBe(1);
 // Another person signs in in the same tab while the first read is on its way.
 await screen.rerender(draw('person-b',url));
 await expect.poll(()=>answers.length).toBe(2);
 // The first reader's answer lands after the change.
 answers[0]('person-a');
 await new Promise(resolve=>setTimeout(resolve,100));
 await expect.element(screen.getByTestId('shown')).toHaveTextContent('nothing');
 await expect.element(screen.getByTestId('state')).toHaveTextContent('reading');
 // A part drawn again for the new reader, before their own read lands, finds nothing kept from the first reader.
 await screen.rerender(draw('person-b',url,'again'));
 await expect.element(screen.getByTestId('shown')).toHaveTextContent('nothing');
 // The part drawn again asked for its own read; the new reader's answer lands and is shown, and a part drawn again for
 // them is given it.
 await expect.poll(()=>answers.length).toBe(3);
 answers[2]('person-b');
 await expect.element(screen.getByTestId('shown')).toHaveTextContent('person-b');
 held();
 await screen.rerender(draw('person-b',url,'third'));
 await expect.element(screen.getByTestId('shown')).toHaveTextContent('person-b');
});

test('a part still on screen when the reader changes stops showing the first reader\'s read',async()=>{
 const url=partUrl('co-reader-shown','about',{agent:'a'});
 const answers=held();
 const screen=await render(draw('person-a',url));
 await expect.poll(()=>answers.length).toBe(1);
 answers[0]('person-a');
 await expect.element(screen.getByTestId('shown')).toHaveTextContent('person-a');
 await screen.rerender(draw('person-b',url));
 await expect.element(screen.getByTestId('shown')).toHaveTextContent('nothing');
});
