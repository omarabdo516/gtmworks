'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Opening an Agent Lead made at your request takes its "new" mark away (#13). It is asked once the page has mounted,
// never while the page is rendered on the server or prefetched; the sidebar is then drawn again without the mark.
export function OpenedMark({company,agent}:{company:string,agent:string}) {
 const router=useRouter();
 useEffect(()=>{
  void fetch('/api/agent-opened',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({company,agent}),cache:'no-store'})
   .then(response=>response.ok?response.json():null).then(result=>{if(result?.opened) router.refresh();}).catch(()=>{});
 },[company,agent,router]);
 return null;
}
