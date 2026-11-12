import type { ReactNode } from 'react';
import Link from './link';

type Props = { children: ReactNode; className?: string } & (
 { href: string; as?: never } | { href?: never; as?: 'div' | 'span' | 'h2' }
);

export function AuthoredTitle({ children, className, href, as: Tag = 'div' }: Props) {
 const props = { className: ['authored-title', className].filter(Boolean).join(' '), dir: 'auto' };
 return href !== undefined
  ? <Link {...props} href={href}>{children}</Link>
  : <Tag {...props}>{children}</Tag>;
}
