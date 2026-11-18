import type { I18n } from '@/lib/i18n.mjs';
import { backupExcludes, backupIncludes, backupCommands } from '@/lib/backup.mjs';
import { SettingsIcon } from './settings-icons';
import { CopyCommand } from './settings-backup-copy';

// Settings › Backup, for the Owner alone (#33). The reference's "What a backup holds" section (design-reference/app.js,
// sovBackupHTML), without its Back up now button, automatic-backup switch, backups list and restore buttons: this screen
// only says what the archive holds and leaves out, and shows the host commands, each copyable with one press. Restore
// stays on the host and accepts an empty install only; no route backs up or restores.
export function BackupSection({t}:{t:I18n['t']}) {
 const label=(id:string,text:string)=><h4 className="dp-label" id={id}><span>{text}</span></h4>;
 return <>
  <header className="sov-head"><div className="sov-head__t"><h3 className="sov-h" id="sov-h" tabIndex={-1}>{t('settingsBackup')}</h3><p className="sov-sub">{t('settingsBackupSub')}</p></div></header>
  <section className="dp-sec" aria-labelledby="bk-h-in">
   {label('bk-h-in',t('settingsBackupHolds'))}
   <div className="bk-holds">
    <div className="panel-card">
     <div className="panel-row"><span className="panel-row__icon"><SettingsIcon name="check"/></span><span className="panel-row__text"><span className="panel-row__t"><b>{t('settingsBackupIncluded')}</b></span></span></div>
     {backupIncludes.map(item=><div className="panel-row" key={item.title}><span className="panel-row__text"><span className="panel-row__t">{t(item.title)}</span><span className="panel-row__d">{t(item.detail)}{item.file&&<> · <bdi dir="ltr">{item.file}</bdi></>}</span></span></div>)}
    </div>
    <div className="panel-card">
     <div className="panel-row"><span className="panel-row__icon"><SettingsIcon name="x"/></span><span className="panel-row__text"><span className="panel-row__t"><b>{t('settingsBackupNotIncluded')}</b></span></span></div>
     {backupExcludes.map(item=><div className="panel-row" key={item.title}><span className="panel-row__text"><span className="panel-row__t">{t(item.title)}</span>{item.detail&&<span className="panel-row__d">{t(item.detail)}</span>}</span></div>)}
    </div>
   </div>
  </section>
  <section className="dp-sec" aria-labelledby="bk-h-cmd">
   {label('bk-h-cmd',t('settingsBackupCommands'))}
   <div className="panel-card">
    {backupCommands.install.map(({title,command})=><div className="panel-row bk-cmd" key={command}>
     <span className="panel-row__text"><span className="panel-row__t">{t(title)}</span><code className="sub-code sub-code--cmd" dir="ltr">{command}</code></span>
     <CopyCommand command={command}/>
    </div>)}
   </div>
   <p className="set-hint">{t('settingsBackupRestoreEmpty')}</p>
  </section>
  <section className="dp-sec" aria-labelledby="bk-h-src">
   {label('bk-h-src',t('settingsBackupFromSource'))}
   <div className="panel-card">
    {backupCommands.source.map(command=><div className="panel-row bk-cmd" key={command}>
     <span className="panel-row__text"><code className="sub-code sub-code--cmd" dir="ltr">{command}</code></span>
     <CopyCommand command={command}/>
    </div>)}
   </div>
  </section>
 </>;
}
