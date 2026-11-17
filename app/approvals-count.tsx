import { Suspense, use } from 'react';
import Link from '@/lib/link';
import { waitingLabel } from '@/lib/sidebar.mjs';

type T=(key:string,...values:unknown[])=>string;
type Props={slug:string,current:boolean,t:T};

// The approvals entry beside Marketing board in the sidebar (app/shell.tsx): its own link to the Inbox, with the count
// of what waits on the reader. A page may hand the count over while it is still being read (Numbers, #172): the pill
// then holds its place, empty, until the count arrives.
export default function ApprovalsCount({count,...props}:Props&{count:number|Promise<number>}) {
 if(typeof count==='number') return <Pill {...props} count={count}/>;
 return <Suspense fallback={<Pill {...props}/>}><Counted {...props} count={count}/></Suspense>;
}

function Counted({count,...props}:Props&{count:Promise<number>}) {
 return <Pill {...props} count={use(count)}/>;
}

function Pill({slug,current,t,count}:Props&{count?:number}) {
 const [key,...values]=count===undefined?['approvals']:waitingLabel(count);
 return <Link className={`sb-count${count?'':' sb-count--none'}`} href={`/c/${slug}/approvals`} aria-current={current?'page':undefined} aria-label={t(key,...values)}><span className="sb-count__n">{count}</span></Link>;
}
