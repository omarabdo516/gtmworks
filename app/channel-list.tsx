'use client';
import { lazy, Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from '@/lib/link';
import { useShellPlace } from './shell-place';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { ShellIcon } from '@/components/shell-icon';
import { channelTitle } from '@/lib/channels';
import { useSidebarChannels } from './sidebar-live';

const NewChannel=lazy(()=>import('./new-channel-dialog'));

// design-reference: renderThreadList. The channels and their counts follow the sidebar's poll (app/sidebar-live). The
// open channel is being read, so it shows no count; ?new=channel opens New channel from any page, which is how its
// compared screen reaches it.
export default function ChannelList({slug,company,person,current:drawn,manage}:{slug:string,company:string,person:string,current?:string,manage:boolean}) {
 const place=useShellPlace(); const current=drawn??place.channel;
 const {t,language}=useI18n();
 const router=useRouter(); const path=usePathname(); const search=useSearchParams();
 const channels=useSidebarChannels();
 const [opened,setOpened]=useState(false);
 const asked=search.get('new')==='channel';
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
