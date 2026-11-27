import { Suspense, use } from 'react';
import { CountPill } from './approvals-count-pill';

type Props={slug:string,company?:string,current?:boolean};

// The approvals entry beside Marketing board in the sidebar (app/shell.tsx): its own link to the Inbox, with the count
// of what waits on the reader. The count may still be on its way when the sidebar is drawn (the Company's layout reads it
// beside the sidebar, #789; Numbers did, #172): the pill then holds its place, empty, until the count arrives. The
// Company's board Cards that wait on the reader are added in the browser, from the board read (#841).
export default function ApprovalsCount({count,...props}:Props&{count:number|Promise<number|undefined>}) {
 if(typeof count==='number') return <Pill {...props} count={count}/>;
 return <Suspense fallback={<Pill {...props}/>}><Counted {...props} count={count}/></Suspense>;
}

function Counted({count,...props}:Props&{count:Promise<number|undefined>}) {
 return <Pill {...props} count={use(count)}/>;
}

function Pill({slug,company,current,count}:Props&{count?:number}) {
 return <CountPill key={slug} href={`/c/${slug}/approvals`} company={company} current={current} count={count}/>;
}
