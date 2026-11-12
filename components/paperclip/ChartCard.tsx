import type { ReactNode } from 'react';
export function ChartCard({title,subtitle,children}:{title:string,subtitle:string,children:ReactNode}) {
 return <article className="panel border border-border rounded-lg p-4 space-y-3">
  <div><h2 className="text-xs font-medium text-muted-foreground">{title}</h2><span className="text-[10px] text-muted-foreground">{subtitle}</span></div>{children}
 </article>;
}
