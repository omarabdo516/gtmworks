import type { ReactNode } from 'react';
import { InfoTip } from './settings-info';

// The settings overlay's page head and section label (design-reference/app.js: sovHead, Label), kept apart from the
// overlay's data so a section in its own file, and a component test, draw the same ones. A page or a section carries no
// paragraph under its name (#614; DESIGN.md "Settings copy"): its explanation is `info`, behind the "i" after the name,
// and `meta` is one short muted fact beside the name, such as a count.
export const Head=({title,info,meta,extra}:{title:string,info?:ReactNode,meta?:ReactNode,extra?:ReactNode})=><header className="sov-head"><div className="sov-head__t"><div className="sov-head__row"><h3 className="sov-h" id="sov-h" tabIndex={-1}>{title}</h3>{info&&<InfoTip about={title} id="sov-h-info">{info}</InfoTip>}{meta&&<span className="sov-h-meta">{meta}</span>}</div></div>{extra}</header>;
export const Label=({id,info,about,infoId,children}:{id:string,info?:ReactNode,about?:string,infoId?:string,children:ReactNode})=><h4 className="dp-label" id={info?undefined:id}><span>{info?<span id={id}>{children}</span>:children}{info&&<InfoTip about={about??(typeof children==='string'?children:'')} id={infoId??`${id}-info`}>{info}</InfoTip>}</span></h4>;
// A part inside one of an Agent page's groups (#615): the same quiet label one level below the group's heading.
export const SubLabel=({id,info,infoId,children}:{id:string,info?:ReactNode,infoId?:string,children:ReactNode})=><h5 className="dp-label" id={info?undefined:id}><span>{info?<span id={id}>{children}</span>:children}{info&&<InfoTip about={typeof children==='string'?children:''} id={infoId??`${id}-info`}>{info}</InfoTip>}</span></h5>;
// One of an Agent page's five groups (#615): its name once, then its rows and parts.
export const Group=({id,title,info,infoId,children}:{id:string,title:string,info?:ReactNode,infoId?:string,children:ReactNode})=><section className="set-group" aria-labelledby={id}><h4 className="set-group__h" id={info?undefined:id}>{info?<><span id={id}>{title}</span><InfoTip about={title} id={infoId??`${id}-info`}>{info}</InfoTip></>:title}</h4>{children}</section>;
