'use client';
import { useI18n } from '@/lib/i18n-client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from '@/lib/link';
import { AuthoredTitle } from '@/lib/authored-title';
type Card={id:number,title:string};
type Result={company:string,cards:Card[],error:boolean};
const RecentCardsContext=createContext<Result|undefined>(undefined);
export function RecentCardsProvider({company,cardId,children}:{company:string,cardId?:number,children:ReactNode}) {
 const pending=useRef(Promise.resolve());
 const [result,setResult]=useState<Result>();
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
 },[company,cardId]);
 return <RecentCardsContext.Provider value={result?.company===company?result:undefined}>{children}</RecentCardsContext.Provider>;
}
export default function RecentCards({slug}:{slug:string}) {
 const {t}=useI18n();
 const result=useContext(RecentCardsContext);
 if(!result) return null;
 if(result.error) return <p className="recent-error" role="status">{t('couldNotLoadRecentCards')}</p>;
 if(!result.cards.length) return null;
 return <section className="thread-group recent-cards" aria-labelledby="lbl-recent-cards"><h2 className="sb-label" id="lbl-recent-cards">{t('recent')}</h2>{result.cards.map(card=><Link key={card.id} className="sb-item thread-item" href={`/c/${slug}/work/board/${card.id}`} title={card.title}><AuthoredTitle as="span" className="recent-title od-truncate">{card.title}</AuthoredTitle></Link>)}</section>;
}
