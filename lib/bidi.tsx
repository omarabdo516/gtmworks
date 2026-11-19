// A line keeps the interface's direction and isolates the runs of the other script it quotes (design-reference: bx,
// bxLtr): the Arabic example in English, an Agent's Latin name or an email in Arabic.
export const isolate=(text:string,rtl:boolean)=>text.split(rtl?/([A-Za-z](?:[A-Za-z0-9 &.@_+-]*[A-Za-z0-9])?)/:/([\u0600-\u06FF](?:[^A-Za-z“”"]*[\u0600-\u06FF])?)/)
 .map((part,index)=>index%2?<bdi key={index} dir={rtl?'ltr':'rtl'}>{part}</bdi>:part);
// A sentence with one name in it, the name isolated (and bold where the row's style says so, design-reference:
// .handoff__t bdi). `say` fills a catalogue key's {0}.
export const named=(say:(key:string,...values:unknown[])=>string,key:string,name:string)=>{ const [before,after]=say(key,'\u0000').split('\u0000'); return <>{before}<bdi>{name}</bdi>{after}</>; };

// The right-to-left scripts this helper names; every other letter (`\p{L}`) is strong left to right.
const rtlScript=/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}]/u;
// The direction of a text's first strong letter, so a reply card sets `dir` once from its title (design-reference:
// cardHTML) and every text on it follows the card. Every letter counts, in whatever script, so Latin Extended Additional
// ("Ẁ"), Armenian, CJK and a script the helper has not seen before read left to right; a text with no strong letter
// ("2026", an emoji) keeps the interface's own direction.
export const directionOf=(text:string,fallback:'ltr'|'rtl'):'ltr'|'rtl'=>
 { const strong=/\p{L}/u.exec(text)?.[0]; return strong?(rtlScript.test(strong)?'rtl':'ltr'):fallback; };
