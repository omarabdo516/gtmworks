import { Suspense, use } from 'react';
import { CountPill } from './approvals-count-pill';

type Props={slug:string,current?:boolean};

// The approvals entry beside Marketing board in the sidebar (app/shell.tsx): its own link to the Inbox, with the count
// of what waits on the reader. The count may still be on its way when the sidebar is drawn (the Company's layout reads it
// beside the sidebar, #789; Numbers did, #172): the pill then holds its place, empty, until the count arrives.
export default function ApprovalsCount({count,...props}:Props&{count:number|Promise<number>}) {
 if(typeof count==='number') return <Pill {...props} count={count}/>;
 return <Suspense fallback={<Pill {...props}/>}><Counted {...props} count={count}/></Suspense>;
}

function Counted({count,...props}:Props&{count:Promise<number>}) {
 return <Pill {...props} count={use(count)}/>;
}

function Pill({slug,current,count}:Props&{count?:number}) {
 return <CountPill key={slug} href={`/c/${slug}/approvals`} current={current} count={count}/>;
}
