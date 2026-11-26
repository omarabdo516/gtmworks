import { notFound } from 'next/navigation';
import { getI18n } from '@/lib/i18n-server';
import { sections } from '@/lib/navigation';
import { companyReader } from '@/lib/company-reader';
import Page from '@/app/page-frame';

// Settings at their own address (#612): the Company's frame, out of reach under the overlay the `settings` slot draws
// over it (app/c/[slug]/@settings/settings, app/settings-overlay-frame.tsx). It is the page slot's default, not a page: a
// page here would be fetched again at its Settings address on every refresh, and that address now opens the overlay over
// a page, not this frame. Signed out, it draws nothing; the slot sends the person to sign in.
export default async function SettingsFrame({params}:{params:Promise<{slug:string}>}) {
 const {t}=await getI18n(); const {slug}=await params;
 const reader=await companyReader(slug);
 if(!reader) return null;
 if(!reader.company) notFound();
 return <div className="contents" inert><Page title={t(sections.settings)}><main className="content"/></Page></div>;
}
