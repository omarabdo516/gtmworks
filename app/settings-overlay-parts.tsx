import type { ReactNode } from 'react';

// The settings overlay's page head and section label (design-reference/app.js: sovHead, Label), kept apart from the
// overlay's data so a section in its own file, and a component test, draw the same ones.
export const Head=({title,sub,extra}:{title:string,sub?:string,extra?:ReactNode})=><header className="sov-head"><div className="sov-head__t"><h3 className="sov-h" id="sov-h" tabIndex={-1}>{title}</h3>{sub&&<p className="sov-sub">{sub}</p>}</div>{extra}</header>;
export const Label=({id,children}:{id:string,children:ReactNode})=><h4 className="dp-label" id={id}><span>{children}</span></h4>;
// A part inside one of an Agent page's groups (#615): the same quiet label one level below the group's heading.
export const SubLabel=({id,children}:{id:string,children:ReactNode})=><h5 className="dp-label" id={id}><span>{children}</span></h5>;
// One of an Agent page's five groups (#615): its name once, then its rows and parts.
export const Group=({id,title,children}:{id:string,title:string,children:ReactNode})=><section className="set-group" aria-labelledby={id}><h4 className="set-group__h" id={id}>{title}</h4>{children}</section>;
