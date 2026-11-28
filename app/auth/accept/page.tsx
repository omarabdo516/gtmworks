import Link from '@/lib/link';
import { getI18n } from '@/lib/i18n-server';
// The page an email invitation's link returns to (#185). Email invitations are ended since #953: whoever follows an old
// one is told to ask their Administrator for an Invite link, and an account holder can sign in.
export default async function Accept() {
 const {t}=await getI18n();
 return <main className="login panel"><p role="status">{t('inviteLinkNeedsNew')}</p><p><Link className="link" href="/sign-in">{t('signIn')}</Link></p></main>;
}
