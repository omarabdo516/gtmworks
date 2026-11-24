// The `MEDIA:` tags an Agent's reply names its files by (#708, ADR 0028), read without anything else: lib/reply-files.mjs
// keeps the files a finished Run hands over, and every screen that shows a reply takes a tag still in it out.
// `MEDIA:` then the path: in backticks or quotes, or a run with no space. The tag itself may be in backticks or quotes,
// as a model writes code. A bare path's closing punctuation is the sentence's, not the path's. A path names a file, so
// it ends in an extension: words after "MEDIA:" in a sentence ("Social MEDIA: tips") are no tag.
const tagPattern=/[ \t]*([`"']?)MEDIA:[ \t]*(`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|[^\s`"']+)\1/g;
const trailing=/[.,;:!?)\]}]+$/;
const fileLike=/\.[A-Za-z0-9]{1,10}$/;

// The reply's text without its tags, and each tag's path in order. A line that held only tags goes with them; a text
// with no tag is handed back exactly as it was.
/** @param {string} text @returns {{body:string,paths:string[]}} */
export function takeFileTags(text) {
 const paths=[];
 const lines=text.split('\n').flatMap(line=>{
  let tagged=false;
  const left=line.replace(tagPattern,(whole,_quote,raw)=>{
   const unquoted=/^[`"']/.test(raw)?raw.slice(1,-1).trim():raw;
   const end=/^[`"']/.test(raw)?'':trailing.exec(unquoted)?.[0]??'';
   const path=end?unquoted.slice(0,-end.length):unquoted;
   if(!fileLike.test(path)) return whole;
   tagged=true; paths.push(path);
   return end;
  });
  if(!tagged) return [line];
  const kept=left.trim();
  return kept?[kept]:[];
 });
 return {body:paths.length?lines.join('\n').trim():text,paths};
}
// The name a tag's file is told by: its last part, never the rest of its path.
/** @param {string} path */
export const fileTagName=path=>(path.split('/').filter(Boolean).at(-1)||'file').slice(0,255);
// A reply's text as a person reads it: a tag still in it (a reply kept before #708, or by a path that hands no file on)
// is taken out and named as a file that could not be attached.
/** @param {string} text @returns {{body:string,missed:string[]}} */
export function shownReply(text) {
 const {body,paths}=takeFileTags(text);
 return {body,missed:[...new Set(paths)].map(fileTagName)};
}
