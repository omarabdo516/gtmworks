import type { supabase } from './supabase';

type Database=Awaited<ReturnType<typeof supabase>>;

// The board's archive list (#670, #705): the archived Cards the reader sees, newest archived first, a page at a time.
// `q` is the title search, `agent` and `project` the board's filters; archived_card_list does each in the database, so a
// search or a filter reads every archived Card, not only the page shown.
export type ArchivedCursor={at:string,id:number};
export type ArchivedWant={q?:string,agent?:string|null,project?:number|null};
export type ArchivedPage<C>={items:C[],next:ArchivedCursor|null};
const archivedPageSize=50;

// One page, read as the signed-in person after `after` (the first page when it is null). A failed read is null.
export async function archivedCardPage<C extends {id:number,archived_at?:string|null}>(db:Database,company:string,{q='',agent=null,project=null}:ArchivedWant,after:ArchivedCursor|null=null):Promise<ArchivedPage<C>|null> {
 const {data,error}=await db.rpc('archived_card_list',{c:company,q:q.trim()||null,agent:agent||null,project:project??null,after_at:after?.at??null,after_id:after?.id??null,lim:archivedPageSize+1}).select('*');
 if(error) return null;
 const rows=(data||[]) as C[];
 const items=rows.slice(0,archivedPageSize);
 const last=items.at(-1);
 return {items,next:rows.length>archivedPageSize&&last?.archived_at?{at:last.archived_at,id:last.id}:null};
}

// How many archived Cards the reader sees: the count on the board's archive icon. Null when it could not be read.
export async function archivedCardCount(db:Database,company:string):Promise<number|null> {
 const {data,error}=await db.rpc('archived_card_count',{c:company});
 return error||typeof data!=='number'?null:data;
}
