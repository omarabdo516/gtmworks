import type { ReactNode } from 'react';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import { companyReader } from '@/lib/company-reader';
import { approvalQueue } from '@/lib/approval-queue';
import Shell from '@/app/shell';

// Every Company page, with Settings as a layer over it (#612). The Shell (the sidebar and the frame) is drawn here once
// (#789): moving between the Company's pages draws only the page, which draws its own top bar and content
// (app/page-frame), and a press paints the page's loading frame inside the Shell at once (app/frame.tsx, #771).
// The `settings` slot holds the overlay: opened from a page of the Company it is drawn over that page, which stays as it
// was (its scroll, its drafts) and is out of reach while the dialog is open (data-workspace,
// app/settings-overlay-frame.tsx); opened at its own address it is drawn over the Company's frame. Closing returns to the
// page underneath. Signed out, or in a Company the person is not a Member of, there is no Shell: the page sends them to
// sign in, or answers "not found".
export default async function CompanyLayout({children,settings,params}:{children:ReactNode,settings:ReactNode,params:Promise<{slug:string}>}) {
 const {slug}=await params;
 const reader=await companyReader(slug);
 const company=reader?.company;
 if(!reader||!company) return <><div className="contents" data-workspace>{children}</div>{settings}</>;
 const {t}=await getI18n();
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const db=await supabase();
 // Waiting on you is counted beside the sidebar's reads, so the count never holds the frame (app/approvals-count.tsx):
 // its list's rows here, and the Engine's Cards that wait on the reader by the browser, from the board read (#841).
 // A count that could not be read leaves the pill empty until the sidebar's poll counts it, never the whole Shell an error.
 const approvals=approvalQueue(db,company.id,reader.user.id,reader.role).then(({rows})=>rows,()=>undefined);
 return <><div className="contents" data-workspace><Shell company={company} companies={reader.companies} personId={reader.user.id} personName={reader.person?.name||reader.user.email||''} role={roleNames[reader.role]||''} owner={reader.role==='owner'} manage={reader.manage} canWrite={reader.canWrite} approvalCount={approvals}>{children}</Shell></div>{settings}</>;
}
