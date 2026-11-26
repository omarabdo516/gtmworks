import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Shell from '@/app/shell';
import { companyReader } from '@/lib/company-reader';
import { approvalQueue } from '@/lib/approval-queue';
import { getI18n } from '@/lib/i18n-server';

// Every Company page, with Settings as a layer over it (#612). The `settings` slot holds the overlay: opened from a page
// of the Company it is drawn over that page, which stays as it was (its scroll, its drafts) and is out of reach while
// the dialog is open (data-workspace, app/settings-overlay-frame.tsx); opened at its own address it is drawn over the
// Company's frame. Closing returns to the page underneath.
// The Shell is drawn here, once (#789): moving between the Company's pages draws only the page, reads no sidebar and
// paints at once. Nobody signed in: the page sends them to sign in, with the address it was asked for.
export default async function CompanyLayout({children,settings,params}:{children:ReactNode,settings:ReactNode,params:Promise<{slug:string}>}) {
 const {slug}=await params;
 const reader=await companyReader(slug);
 if(!reader) return <><div className="contents" data-workspace>{children}</div>{settings}</>;
 const {db,user,companies,company,personName,role,owner}=reader;
 if(!company) notFound();
 const {t}=await getI18n();
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const approvals=approvalQueue(db,company.id,user.id,role).then(({count})=>count);
 return <><div className="contents" data-workspace><Shell company={company} companies={companies} personId={user.id} personName={personName} role={roleNames[role]||''} owner={owner} approvalCount={approvals}>{children}</Shell></div>{settings}</>;
}
