'use client';

// A file's name as the reference writes it (design-reference: fname): the base runs in the direction of its first
// strong character, so a Latin name (even one starting with "_") runs left to right and an Arabic one right to left,
// and the extension stays isolated at the end, left to right. Drawn by the Library's rows and by the preview's title.
export function FileName({name}:{name:string}) {
 const at=name.lastIndexOf('.');
 const base=at>0?name.slice(0,at):name; const extension=at>0?name.slice(at):'';
 return extension?<><bdi dir="auto">{base}</bdi><bdi dir="ltr">{extension}</bdi></>:<bdi dir="auto">{base}</bdi>;
}
