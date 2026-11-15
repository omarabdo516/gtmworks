import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';

// The quiet line at the top of a person's direct chat with an Agent in a team (#25; design-reference: privLineHTML):
// nobody else reads it.
export function PrivateLine({agent}:{agent:string}) {
 const {t}=useI18n(); const [before,after]=t('conversationPrivate','\u0000').split('\u0000');
 return <p className="priv-line"><ShellIcon name="lock"/><span>{before}<bdi>{agent}</bdi>{after}</span></p>;
}
