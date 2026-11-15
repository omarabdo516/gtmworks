import { roleTemplates, type RoleId } from './role-templates.mjs';
import type { Language } from './i18n.mjs';
import en from './messages/ready-made.en.json';
import ar from './messages/ready-made.ar.json';

type Text=Record<string,string>;
const catalogues:Record<Language,Text>={en,ar};
const fill=(text:string,value:string)=>text.replace('{0}',()=>value);

export type ReadyRole={id:RoleId,category:(typeof roleTemplates)[RoleId]['category'],name:string,role:string,line:string,handoff:string|null,apps:readonly string[],ask:string,search:string};

// The cards of the ready-made gallery (#14), built on the server so the roles' instructions never reach the browser:
// each role's words in the reader's language, the line saying what it hands to a person (the alone wording when the
// Company is worked alone), its apps, the message that asks Lead for it, and what a search finds it by in either language.
export function readyRoles(language:Language,alone:boolean):ReadyRole[] {
 const text=catalogues[language];
 return (Object.keys(roleTemplates) as RoleId[]).map(id=>{
  const {category,name,apps}=roleTemplates[id];
  const role=text[`role.${id}`], english=en[`role.${id}`];
  const words=Object.values(catalogues).flatMap(other=>[`role.${id}`,`line.${id}`,`category.${category}`,`hand.${id}`,`handAlone.${id}`].map(key=>other[key]));
  return {id,category,name,role,line:text[`line.${id}`],handoff:(alone&&text[`handAlone.${id}`])||text[`hand.${id}`]||null,apps,
   // Lead hears the role in the reader's words and, when those are not English, also as create_agent's template names it.
   ask:role===english?fill(text.ask,role):`${fill(text.ask,role)} (${english})`,
   search:[...words,name,...apps].filter(Boolean).join(' ').toLowerCase()};
 });
}
