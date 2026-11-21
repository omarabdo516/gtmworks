import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// PostgREST matches every key of an rpc call's body to a function parameter of that name (#352's review). A key the
// migration does not name matches no signature: the call fails and the work it records never happens, as the worker's
// record of an Agent's tools did while it sent `subagents` for `subagents_written`. Every literal `db.rpc('name', {...})`
// in the app and the service is checked against the signature the migrations create, so a rename on either side fails
// here instead of silently at run time.
const root=fileURLToPath(new URL('..',import.meta.url));

// Every overload of every public function the migrations create, by the parameter names PostgREST matches. Later
// migrations replace a function with the same parameters; an overload with other parameters stays, as create_work_card's
// two do.
function signatures() {
 const found=new Map();
 const migrations=readdirSync(`${root}supabase/migrations`).filter(file=>file.endsWith('.sql')).sort();
 for(const migration of migrations) {
  const sql=readFileSync(`${root}supabase/migrations/${migration}`,'utf8');
  const created=/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(([^)]*)\)/gi;
  let match;
  while((match=created.exec(sql))) {
   const params=match[2].split(',').map(part=>part.trim()).filter(Boolean)
    .map(part=>part.match(/^([a-z0-9_]+)/i)?.[1]).filter(Boolean);
   if(!found.has(match[1])) found.set(match[1],[]);
   const overloads=found.get(match[1]);
   const same=overloads.findIndex(other=>other.length===params.length&&other.every((name,at)=>name===params[at]));
   if(same>=0) overloads[same]=params; else overloads.push(params);
  }
 }
 return found;
}

// The top-level properties of one object literal, as `{key: value, shorthand, ...spread}` writes them. A spread means
// the keys cannot be read here, so the call is skipped rather than guessed at.
function properties(body) {
 const parts=[];
 let depth=0, quote=null, start=0;
 for(let at=0;at<body.length;at++) {
  const character=body[at];
  if(quote) { if(character==='\\') at++; else if(character===quote) quote=null; continue; }
  if(character==="'"||character==='"'||character==='`') { quote=character; continue; }
  if(character==='('||character==='['||character==='{') { depth++; continue; }
  if(character===')'||character===']'||character==='}') { depth--; continue; }
  if(character===','&&depth===0) { parts.push(body.slice(start,at)); start=at+1; }
 }
 parts.push(body.slice(start));
 const keys=[];
 for(const part of parts) {
  const text=part.trim();
  if(!text) continue;
  if(text.startsWith('...')) return null;
  const key=text.match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/);
  if(key) keys.push(key[1]);
 }
 return keys;
}

function sourceFiles(directory) {
 const files=[];
 for(const entry of readdirSync(`${root}${directory}`,{withFileTypes:true})) {
  if(entry.name==='node_modules'||entry.name.startsWith('.')) continue;
  const path=`${directory}/${entry.name}`;
  if(entry.isDirectory()) files.push(...sourceFiles(path));
  else if(/\.(mjs|js|ts|tsx)$/.test(entry.name)) files.push(path);
 }
 return files;
}

test('every rpc call names parameters the migrations create, so PostgREST finds its function', () => {
 const overloads=signatures();
 const calls=[];
 for(const file of [...sourceFiles('lib'),...sourceFiles('app')]) {
  const text=readFileSync(`${root}${file}`,'utf8');
  const called=/\.rpc\(\s*'([a-z0-9_]+)'\s*,\s*\{/g;
  let match;
  while((match=called.exec(text))) {
   let depth=0, at=called.lastIndex-1;
   for(;at<text.length;at++) {
    if(text[at]==='{') depth++;
    else if(text[at]==='}'&&--depth===0) break;
   }
   const keys=properties(text.slice(called.lastIndex,at));
   if(!keys) continue;
   calls.push({file,name:match[1],keys});
  }
 }
 assert.ok(calls.length>100,`found ${calls.length} literal rpc calls`);
 for(const {file,name,keys} of calls) {
  const known=overloads.get(name);
  assert.ok(known,`${file}: ${name} is created by a migration`);
  const matches=known.some(params=>keys.every(key=>params.includes(key)));
  assert.ok(matches,`${file}: ${name} takes ${keys.join(', ')}; the migrations create it with ${known.map(params=>`(${params.join(', ')})`).join(' or ')}`);
 }
});

test('the worker records an Agent\'s tools with the sub-agents parameter the migration names', () => {
 const worker=readFileSync(`${root}lib/company-profiles.mjs`,'utf8');
 assert.match(worker,/record:\['record_agent_profile',\{agent:row\.agent_id,engine_profile:row\.profile,subagents_written:row\.subagents===true\}\]/);
 const record=signatures().get('record_agent_profile').at(-1);
 assert.ok(record.includes('subagents_written'),'the migration keeps the optional sub-agents read-back named subagents_written');
});
