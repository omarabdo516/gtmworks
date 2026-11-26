'use client';
import { useI18n } from '@/lib/i18n-client';
import { useShellPage } from '@/app/shell-page';
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from '@/lib/link';
import { AuthoredTitle } from '@/lib/authored-title';
type Card={id:number,title:string};
type Result={company:string,cards:Card[],error:boolean};
// The cards reach the sidebar through a store, not through the context's value: the provider wraps the whole page,
// and a new value arriving while a part of the page still streams in would make React draw that part again in the
// browser, leaving the streamed copy hidden in the page until React reveals it (#172).
type Store={get:()=>Result|undefined,subscribe:(listener:()=>void)=>()=>void};
const RecentCardsContext=createContext<Store>({get:()=>undefined,subscribe:()=>()=>{}});
export function RecentCardsProvider({company,children}:{company:string,children:ReactNode}) {
 const {cardId}=useShellPage();
 const pending=useRef(Promise.resolve());
 const [store]=useState(()=>{
  let current:Result|undefined; const listeners=new Set<()=>void>();
  return {get:()=>current,set:(next:Result)=>{current=next;listeners.forEach(listener=>listener());},subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};}};
 });
 const setResult=store.set;
 useEffect(()=>{
  let cancelled=false;
  async function load() {
   // The server reads and records visits as the signed-in person, so the Supabase browser client stays out of every page's JavaScript.
   const response=await fetch('/api/recent-cards',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({company,cardId:cardId||undefined}),cache:'no-store'});
   if(!response.ok) throw new Error('Recent cards unavailable');
   const {cards}=await response.json() as {cards:Card[]};
   if(!cancelled) setResult({company,cards,error:false});
  }
  pending.current=pending.current.then(load).catch(()=>{if(!cancelled) setResult({company,cards:[],error:true});});
  return ()=>{cancelled=true;};
 },[company,cardId,setResult]);
 return <RecentCardsContext.Provider value={store}>{children}</RecentCardsContext.Provider>;
}
export default function RecentCards({slug}:{slug:string}) {
 const {t}=useI18n();
 const store=useContext(RecentCardsContext);
 const result=useSyncExternalStore(store.subscribe,store.get,()=>undefined);
 if(!result) return null;
 if(result.error) return <p className="recent-error" role="status">{t('couldNotLoadRecentCards')}</p>;
 if(!result.cards.length) return null;
 return <section className="thread-group recent-cards" aria-labelledby="lbl-recent-cards"><h2 className="sb-label" id="lbl-recent-cards">{t('recent')}</h2>{result.cards.map(card=><Link key={card.id} className="sb-item thread-item" href={`/c/${slug}/work/board/${card.id}`} title={card.title}><AuthoredTitle as="span" className="recent-title od-truncate">{card.title}</AuthoredTitle></Link>)}</section>;
}
