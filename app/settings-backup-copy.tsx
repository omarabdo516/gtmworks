'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { SettingsIcon } from './settings-icons';

// Copies one command when its button is pressed (#33; the reference copies with navigator.clipboard and swallows a
// blocked clipboard). A browser without the async clipboard, such as an install opened over plain HTTP, gets the
// selection fallback. The button says "Copied" for a moment and then offers the command again.
async function writeClipboard(text:string) {
 try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through to selection */ }
 const area=document.createElement('textarea');
 area.value=text; area.setAttribute('readonly',''); area.style.position='fixed'; area.style.opacity='0';
 document.body.append(area); area.select();
 try { return document.execCommand('copy'); } catch { return false; } finally { area.remove(); }
}

export function CopyCommand({command}:{command:string}) {
 const {t}=useI18n();
 const [copied,setCopied]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>>(undefined);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 return <button type="button" className="btn btn--secondary btn--sm bk-copy" aria-label={t('settingsBackupCopyCommand',command)}
  onClick={async()=>{ if(!await writeClipboard(command)) return; setCopied(true); clearTimeout(timer.current); timer.current=setTimeout(()=>setCopied(false),2000); }}>
  <SettingsIcon name="copy"/><span aria-live="polite">{copied?t('settingsBackupCopied'):t('settingsBackupCopy')}</span>
 </button>;
}
