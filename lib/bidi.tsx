// A line keeps the interface's direction and isolates the runs of the other script it quotes (design-reference: bx,
// bxLtr): the Arabic example in English, an Agent's Latin name in Arabic.
export const isolate=(text:string,rtl:boolean)=>text.split(rtl?/([A-Za-z](?:[A-Za-z0-9 &.-]*[A-Za-z0-9])?)/:/([\u0600-\u06FF](?:[^A-Za-z“”"]*[\u0600-\u06FF])?)/)
 .map((part,index)=>index%2?<bdi key={index} dir={rtl?'ltr':'rtl'}>{part}</bdi>:part);
