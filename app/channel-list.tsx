'use client';
import { lazy, Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { ShellIcon } from '@/components/shell-icon';
import { channelTitle, type ChannelSummary } from '@/lib/channels';

const NewChannel=lazy(()=>import('./new-channel-dialog'));
const pollEvery=5000;

// The channels this person is in (#23, #24; design-reference: renderThreadList), the general one first, each with how
// many messages are new to them, asked again while the page shows. The open one is being read, so it has none. An Owner
// or a Manager makes a channel from "+", or by opening any page with ?new=channel.
export default function ChannelList({slug,company,person,initial,current,manage}:{slug:string,company:string,person:string,initial:ChannelSummary[],current?:string,manage:boolean}) {
 const {t,language}=useI18n();
 const router=useRouter(); const path=usePathname(); const search=useSearchParams();
 // A newer page brings its own list; one asked for since then is kept only while it answers that page's list.
 const [polled,setPolled]=useState<{basis:ChannelSummary[],list:ChannelSummary[]}|null>(null);
 const channels=polled?.basis===initial?polled.list:initial;
 const [opened,setOpened]=useState(false);
 const asked=search.get('new')==='channel';
 useEffect(()=>{
  if(!initial.length) return;
  let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined;
  const poll=async()=>{
   if(document.visibilityState==='visible') {
    try {
     const response=await fetch(`/api/channel-list?company=${company}`,{cache:'no-store'});
     if(response.ok&&!stopped) { const list=await response.json() as ChannelSummary[]; setPolled({basis:initial,list}); }
    } catch {}
   }
   if(!stopped) timer=setTimeout(poll,pollEvery);
  };
  timer=setTimeout(poll,pollEvery);
  return ()=>{stopped=true;clearTimeout(timer);};
 },[company,initial]);
 if(!channels.length) return null;
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 const close=()=>{
  setOpened(false);
  if(!asked) return;
  const rest=new URLSearchParams(search); rest.delete('new');
  router.replace(rest.size?`${path}?${rest}`:path);
 };
 return <div className="thread-group">
  <div className="sb-label-row"><h2 className="sb-label" id="lbl-ch">{t('shellChannels')}</h2>
   {manage&&<button type="button" className="sb-add" aria-label={t('shellNewChannel')} title={t('shellNewChannel')} onClick={()=>setOpened(true)}><ShellIcon name="plus"/></button>}</div>
  <ul aria-labelledby="lbl-ch">{channels.map(channel=>{
   const unread=channel.id===current?0:channel.unread;
   return <li key={channel.id}><Link className={`sb-item thread-item ch-item${unread?' is-unread':''}`} href={`/c/${slug}/channels/${channel.id}`} aria-current={channel.id===current?'true':undefined}>
    <ShellIcon name="hash"/><span className="od-truncate"><bdi>{channelTitle(t,channel)}</bdi></span>
    {unread>0&&<span className="sb-unread num" aria-label={t(unread===1?'channelNewMessage':'channelNewMessages',count(unread))}>{count(unread)}</span>}
   </Link></li>;
  })}</ul>
  {manage&&(opened||asked)&&<Suspense fallback={null}><NewChannel slug={slug} company={company} person={person} close={close}/></Suspense>}
 </div>;
}
