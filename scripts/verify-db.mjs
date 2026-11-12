import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Verification companions return JSON objects containing boolean assertions.
export function verifyResult(readback, file='Database verification') {
 const rows=Array.isArray(readback) ? readback : readback?.rows;
 if(!Array.isArray(rows) || !rows.length) throw new Error(`${file}: Database verification returned no rows`);
 let assertions=0;
 const failures=[];
 function visit(assertion, path) {
  if(assertion===false || assertion===null) failures.push(`${path}=${assertion}`);
  if(assertion===true) assertions++;
  else if(assertion!==null && typeof assertion==='object') {
   for(const [key,child] of Object.entries(assertion)) visit(child,Array.isArray(assertion) ? `${path}[${key}]` : `${path}.${key}`);
  }
 }
 visit(rows,'rows');
 if(failures.length) throw new Error(`${file}: Database verification returned false or null: ${failures.join(', ')}`);
 if(!assertions) throw new Error(`${file}: Database verification returned no boolean assertions`);
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 const file=process.argv[2] || 'Database verification';
 try {
  const output=readFileSync(0,'utf8');
  let readback;
  try { readback=JSON.parse(output); }
  catch { throw new Error(`${file}: Database verification returned invalid JSON`); }
  verifyResult(readback,file);
  console.log(`${file}: Database verification passed`);
 } catch(error) { console.error(error.message); process.exitCode=1; }
}
