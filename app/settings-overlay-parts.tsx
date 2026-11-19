import type { ReactNode } from 'react';

// The settings overlay's page head and section label (design-reference/app.js: sovHead, Label), kept apart from the
// overlay's data so a section in its own file, and a component test, draw the same ones.
export const Head=({title,sub,extra}:{title:string,sub?:string,extra?:ReactNode})=><header className="sov-head"><div className="sov-head__t"><h3 className="sov-h" id="sov-h" tabIndex={-1}>{title}</h3>{sub&&<p className="sov-sub">{sub}</p>}</div>{extra}</header>;
export const Label=({id,children}:{id:string,children:ReactNode})=><h4 className="dp-label" id={id}><span>{children}</span></h4>;
