import type { ReactNode } from 'react';
import Link from '@/lib/link';
import type { I18n } from '@/lib/i18n.mjs';
import type { DetailsTab } from '@/lib/agent-details.mjs';
import { ShellIcon } from '@/components/shell-icon';
import { PageIcon } from '@/app/c/[slug]/log/icons';

const Empty=({text}:{text:string})=><div className="panel-card"><p className="panel-empty">{text}</p></div>;

// The details panel's tabs around the lists the server read (agent-details-server.tsx): a list left out is empty and
// shows the reference's empty line. It imports no server code, so a component test draws the tabs as the server does.
export function detailsTabs({t,slug,agent,activity,tools,tasks,files,library,fileCount,log,logCount}:{t:I18n['t'],slug:string,agent:string,activity?:ReactNode,tools?:ReactNode,tasks?:ReactNode,files?:ReactNode,library?:ReactNode,fileCount:number,log?:ReactNode,logCount:number}):Record<DetailsTab,ReactNode> {
 // design-reference: screenSecHTML. The pinned Engine shows no Agent's screen, and gtmworks keeps the browser and
 // computer tools off (lib/agent-levels.mjs), so the screen is always the reference's asleep frame: not a button.
 const screen=<section className="dp-sec" aria-labelledby="scr-h"><h3 className="dp-label"><span id="scr-h">{t('agentScreen')}</span></h3>
  <div className="scr-card"><div className="scr-thumb is-static"><div className="scr is-off">
   <span className="scr__bar" aria-hidden="true"><span className="scr__dots"><i/><i/><i/></span><span className="scr__url" dir="ltr"/></span>
   <span className="scr__body"><span className="scr__off"><ShellIcon name="moon"/><span>{t('agentScreenOff')}</span></span></span>
  </div></div></div></section>;
 return {
  activity:<>{screen}<section className="dp-sec"><h3 className="dp-label"><span>{t('agentLatestActivity')}</span></h3>{activity??<Empty text={t('agentActivityEmpty')}/>}</section>{tools}</>,
  tasks:tasks??<section className="dp-sec"><Empty text={t('agentTasksEmpty')}/></section>,
  // design-reference: filesTabHTML, without its Add button, which is not built: the Agent's Library (#194) above the
  // files of its Cards and of the reader's own Conversations with it.
  files:<>{library}<section className="dp-sec" aria-labelledby="dp-files-h"><h3 className="dp-label" id="dp-files-h"><span>{t('agentFiles')} <span className="muted num">{fileCount}</span></span></h3>
   {files??<Empty text={t('agentFilesEmpty')}/>}</section></>,
  log:<section className="dp-sec"><h3 className="dp-label"><span>{t('chatTabLog')} <span className="muted num">{logCount}</span></span><Link className="link-btn" href={`/c/${slug}/log?who=a:${agent}`}>{t('agentOpenLog')}</Link></h3>
   {log??<Empty text={t('agentLogEmpty')}/>}
   <p className="lg-forever"><PageIcon name="lock"/><span>{t('logForever')}</span></p>
  </section>,
 };
}
