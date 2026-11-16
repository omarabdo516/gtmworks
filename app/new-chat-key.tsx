'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { askComposerFocus, startsNewChat } from '@/lib/composer-focus';

// The shell draws this only for a person who can write; it listens for "N" (lib/composer-focus) and opens the new chat
// with its composer focused. Already on the new chat, it only focuses the composer.
export default function NewChatKey({href}:{href:string}) {
 const router=useRouter();
 useEffect(()=>{
  const press=(event:KeyboardEvent)=>{
   if(!startsNewChat(event)) return;
   event.preventDefault();
   askComposerFocus(href);
   if(location.pathname!==href||location.search) router.push(href);
  };
  document.addEventListener('keydown',press); return ()=>document.removeEventListener('keydown',press);
 },[href,router]);
 return null;
}
