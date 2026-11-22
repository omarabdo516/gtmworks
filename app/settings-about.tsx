import type { I18n, Language } from '@/lib/i18n.mjs';
import { whatsNew, installedVersion } from '@/lib/updates.mjs';
import { Head, Label } from './settings-overlay-parts';
import { SettingsIcon } from './settings-icons';

type Entry=(typeof whatsNew)[number];
// The newest changes are shown; the earlier ones open from one row below them.
const shownNotes=5;
// Each entry's day, as lib/whats-new.json writes it, in the reader's language. It is a day, not a moment: read in UTC so
// no time zone moves it.
const day=(date:string,locale:string)=>new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${date}T00:00:00Z`));

// Settings › About (#616), for every Role: the installed version as the image knows it (GTMWORKS_VERSION), What's new
// from the same release notes Update ready reads (lib/whats-new.json) in the interface language, and the licenses, each
// opened as plain text from the app itself (/licenses/<name>), so an install offline still shows them. It reads nothing
// from the database and imports no server code, so its component test draws it as the server does.
export function AboutSection({t,language,locale,version,entries=whatsNew}:{t:I18n['t'],language:Language,locale:string,version?:string,entries?:Entry[]}) {
 const installed=installedVersion(version);
 const note=(item:Entry)=><li className="panel-row ab-note" key={item.issue}><span className="panel-row__text">
  <span className="panel-row__t">{item[language].title}</span><span className="panel-row__d">{item[language].body}</span></span>
  <time className="panel-row__meta" dateTime={item.date}>{day(item.date,locale)}</time></li>;
 const older=entries.slice(shownNotes);
 const license=(href:string,title:string,detail:string)=><a className="panel-row" href={href} target="_blank" rel="noopener">
  <span className="panel-row__text"><span className="panel-row__t">{title}</span><span className="panel-row__d">{detail}</span></span>
  <span className="panel-row__meta"><SettingsIcon name="forward" rtl={language==='ar'}/><span className="sr-only">{t('aboutOpens')}</span></span></a>;
 return <><Head title={t('settingsAboutApp')}/>
  <section className="dp-sec" aria-labelledby="ab-h-ver"><Label id="ab-h-ver">{t('version')}</Label>
   <div className="panel-card"><div className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('aboutProduct')}</span></span>
    <span className="panel-row__meta ab-version">{installed.kind==='source'?t('aboutVersionSource'):<bdi dir="ltr">{installed.name}</bdi>}</span></div></div></section>
  <section className="dp-sec" aria-labelledby="ab-h-new"><Label id="ab-h-new">{t('whatsNew')}</Label>
   <div className="panel-card"><ul className="ab-notes">{entries.slice(0,shownNotes).map(note)}</ul>
    {older.length>0&&<details className="ab-older"><summary className="panel-row"><span className="panel-row__t od-fill">{t('aboutWhatsNewOlder',older.length)}</span><SettingsIcon name="forward" rtl={language==='ar'} className="ab-older__chev"/></summary>
     <ul className="ab-notes">{older.map(note)}</ul></details>}</div></section>
  <section className="dp-sec" aria-labelledby="ab-h-lic"><Label id="ab-h-lic">{t('aboutLicenses')}</Label>
   <div className="panel-card">{license('/licenses/gtmworks',t('aboutProduct'),t('aboutLicenseMit'))}{license('/licenses/third-party',t('aboutThirdParty'),t('aboutThirdPartyD'))}</div></section>
 </>;
}
