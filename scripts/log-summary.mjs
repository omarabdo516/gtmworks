// Turns a failed install's web or gateway log (stdin) into counted, fixed fields, for a public CI log: request method,
// area and status; known error classes and error codes; code locations in this repository's own build or its direct
// packages; fixed gateway failure kinds; install-env names. No other text from the log is ever printed, so a secret,
// known or not, long or short, in any encoding, has nowhere to appear. Anything unrecognised is only counted.
// Usage: node log-summary.mjs web|gateway <app directory> <package.json>. Without what it checks against, it prints nothing.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const methods=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
const errorClasses=new Set(['Error','TypeError','ReferenceError','SyntaxError','RangeError','URIError','EvalError','AggregateError','AbortError','TimeoutError',
 'AuthApiError','AuthRetryableFetchError','AuthSessionMissingError','PostgrestError','StorageError','StorageApiError','DynamicServerError']);
const codes=new Set(['ECONNREFUSED','ECONNRESET','ENOTFOUND','ETIMEDOUT','EAI_AGAIN','EADDRINUSE','EACCES','ENOENT','EPIPE','EHOSTUNREACH',
 'UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','UND_ERR_HEADERS_TIMEOUT','ERR_INVALID_URL','ERR_MODULE_NOT_FOUND','ERR_INVALID_ARG_TYPE']);
const gatewayKinds=[[/connect\(\) failed \(111: Connection refused\)/,'upstream-refused'],[/upstream timed out/,'upstream-timeout'],[/no live upstreams/,'upstream-unavailable'],
 [/could not be resolved|host not found in upstream/,'upstream-unresolved'],[/upstream prematurely closed/,'upstream-closed'],[/Connection reset by peer/,'upstream-reset']];
const nextFiles=new Set(['page.js','route.js','layout.js','error.js','not-found.js','loading.js','default.js']);
const gatewayAreas=['auth','rest','storage','_next'];

export function summarise(service,text,{appDirectory,packages,envNames}) {
 const areas=new Set([...gatewayAreas,...readdirSync(appDirectory).filter(name=>statSync(join(appDirectory,name)).isDirectory())]);
 const segment=/^[a-z0-9_\-[\]]+(\.\.\.[a-z0-9_-]+\]?\]?)?$/i;
 const routeExists=route=>route.split('/').every(part=>segment.test(part)&&!/^\.+$/.test(part))&&existsSync(join(appDirectory,route));
 const location=frame=>{
  if(frame.startsWith('node:internal/')) return 'node-internal';
  const at=frame.match(/^\/app\/(.+):(\d{1,7}):(\d{1,7})$/); if(!at) return 'other';
  const [,path,line,column]=at, place=`:${line}:${column}`;
  const page=path.match(/^\.next\/server\/app\/(.+)\/([a-z-]+\.js)$/);
  if(page&&nextFiles.has(page[2])&&routeExists(page[1])) return `.next/server/app/${page[1]}/${page[2]}${place}`;
  if(/^\.next\/server\/(chunks\/(ssr\/)?\d{1,6}|webpack-runtime|middleware|instrumentation)\.js$/.test(path)) return path+place;
  const pkg=path.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if(pkg&&packages.has(pkg[1])) return `node_modules/${pkg[1]}`;
  return 'other';
 };
 const counts=new Map(), add=field=>counts.set(field,(counts.get(field)||0)+1);
 const lines=text.split('\n').filter(line=>line.trim());
 let recognised=0;
 for(const line of lines) {
  const fields=new Set();
  const request=line.match(/"(\S+) (\S+) HTTP\/[\d.]+" (\d{3}) /);
  if(request) {
   const area=request[2].split(/[?#]/)[0].split('/')[1] ?? '';
   fields.add(`request ${methods.has(request[1])?request[1]:'other'} ${area===''?'root':areas.has(area)?area:'other'} ${request[3]}`);
  }
  for(const [pattern,kind] of gatewayKinds) if(pattern.test(line)) fields.add(`gateway ${kind}`);
  const frame=line.match(/^\s*at (?:.*? \()?((?:\/app\/|node:internal\/)[^\s()]+)\)?\s*$/);
  if(frame) fields.add(`at ${location(frame[1])}`);
  const thrown=line.match(/(?:^|\s)([A-Z][A-Za-z0-9]*Error)(?=:)/);
  if(thrown) fields.add(`error ${errorClasses.has(thrown[1])?thrown[1]:'other'}`);
  for(const word of line.match(/\b[A-Z0-9_]{4,40}\b/g) || []) if(codes.has(word)||/^PGRST\d{3}$/.test(word)) fields.add(`code ${word}`);
  const env=line.match(/^\s*([A-Z0-9_]+) must (be|equal)\b/);
  if(env) fields.add(`install-env ${envNames.has(env[1])?env[1]:'other'}`);
  if(/✓ Ready in \d+/.test(line)) fields.add('ready');
  if(fields.size) recognised++;
  fields.forEach(add);
 }
 return [`${service} lines ${lines.length} recognised ${recognised} x1`,...[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([field,count])=>`${service} ${field} x${count}`)].join('\n')+'\n';
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  const [service,appDirectory,packageFile]=process.argv.slice(2);
  if(!['web','gateway'].includes(service)) throw new Error('usage');
  const manifest=JSON.parse(readFileSync(packageFile,'utf8'));
  const packages=new Set(Object.keys({...manifest.dependencies,...manifest.devDependencies}));
  // Imported here, so a missing file also ends in the one closed failure below.
  const {generateInstallEnv}=await import('../lib/install-env.mjs');
  const envNames=new Set(Object.keys(generateInstallEnv()));
  process.stdout.write(summarise(service,readFileSync(0,'utf8'),{appDirectory,packages,envNames}));
 } catch {
  // The reason could quote the log, so it is not printed.
  console.error('Log summary unavailable.'); process.exitCode=1;
 }
}
