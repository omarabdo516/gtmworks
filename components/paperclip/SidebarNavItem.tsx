import type { ReactNode } from 'react';
import Link from '@/lib/link';
import { cn } from './utils';
import { Badge } from './ui/badge';

export function SidebarNavItem({href,active,icon,children,badge,className}:{href:string,active?:boolean,icon:ReactNode,children:ReactNode,badge?:number,className?:string}) {
 return <Link href={href} aria-current={active?'page':undefined} className={cn(
  'flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors',
  active?'active bg-sidebar-accent text-sidebar-accent-foreground':'text-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',className
 )}>{icon}{children}{badge!==undefined&&<Badge variant="ghost" className="badge ms-auto px-1.5 leading-none bg-primary text-primary-foreground">{badge}</Badge>}</Link>;
}
