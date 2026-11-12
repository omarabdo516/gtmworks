import type { ReactNode } from 'react';

// IssueDetail's page surface; gtmworks supplies marketing fields and activity.
export function IssueDetail({title,children}:{title:string,children:ReactNode}) {
 return <section className="modal card-detail relative space-y-6"><div className="card-detail-heading"><h2 dir="auto" className="authored-title text-xl font-bold">{title}</h2></div>{children}</section>;
}
