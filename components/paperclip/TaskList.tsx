import type { ReactNode } from 'react';

// TaskListColumns viewport and IssueRow band, retaining native table semantics.
export function TaskList({children,emptyMessage}:{children:ReactNode,emptyMessage?:string}) {
 return <div className="table-wrap -mx-2 sm:mx-0">{emptyMessage&&<p className="empty-column">{emptyMessage}</p>}<table className="table text-sm">{children}</table></div>;
}
export function TaskListRow({children}:{children:ReactNode}) {
 return <tr className="group relative text-sm text-inherit border-b border-border last:border-b-0 hover:bg-accent/50">{children}</tr>;
}
