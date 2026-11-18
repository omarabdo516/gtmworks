'use client';

// A file's name as the reference writes it (design-reference: fname): an Arabic name keeps its extension at its end, a
// Latin one runs left to right as a whole. Drawn by the Library's rows and by the preview's title.
export function FileName({name}:{name:string}) {
 const at=name.lastIndexOf('.');
 const base=at>0?name.slice(0,at):name; const extension=at>0?name.slice(at):'';
 if(/^[A-Za-z0-9]/.test(base)) return <bdi dir="ltr">{name}</bdi>;
 return <><bdi dir="rtl">{base}</bdi>{extension?<bdi dir="ltr">{extension}</bdi>:null}</>;
}
