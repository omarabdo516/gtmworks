import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { load } from 'js-yaml';

// Marker secrets the summary has never been told about: a long unknown one, a short one, and other encodings of both.
// None sits in an env file, so only a summary that prints no arbitrary text can keep them out.
const long=randomBytes(24).toString('base64url'), short='Qz7v';
const markers=[long,short,short.toLowerCase(),short.toUpperCase(),encodeURIComponent(`${short}/+=`),Buffer.from(long).toString('hex'),Buffer.from(short).toString('base64').replace(/=+$/,''),[...long].reverse().join('')];
const webLog=[
 '▲ Next.js 15.0.0',
 '✓ Ready in 120ms',
 ` ⨯ TypeError: Cannot read properties of undefined (reading '${long}')`,
 '    at render (/app/.next/server/app/sign-in/page.js:1:2345)',
 '    at async run (/app/.next/server/chunks/948.js:12:40)',
 '    at fetchKey (/app/node_modules/@supabase/supabase-js/dist/main/index.js:3:9)',
 '    at internal (node:internal/process/task_queues:95:5)',
 `    at ${short} (/app/.next/server/chunks/${short}.js:1:1)`,
 `    at x (/app/.next/server/app/${short}/page.js:1:1)`,
 `    at y (/app/node_modules/${short.toLowerCase()}/index.js:1:1)`,
 `    at z (/app/lib/${short}.mjs:1:1)`,
 ` ⨯ ${short}Error: ${short}`,
 `Error: connect ECONNREFUSED 172.18.0.4:5432 code: 'ECONNREFUSED' key=${short}`,
 `{"code":"PGRST301","message":"JWT ${long}","hint":"${short}"}`,
 `code: 'E${short.toUpperCase()}'`,
 `SUPABASE_JWT_SECRET must be an install-generated secret`,
 `${short.toUpperCase()}_TOKEN must be an install-generated secret`,
 `Authorization: Bearer ${short} apikey=${long} ${encodeURIComponent(`${short}/+=`)} ${Buffer.from(long).toString('hex')}`,
 ''
].join('\n');
const gatewayLog=[
 `172.18.0.1 - - [13/Nov/2026:10:00:00 +0000] "GET /sign-in?next=${short} HTTP/1.1" 500 21 "-" "curl/8.12.1 ${long}" "-"`,
 `172.18.0.1 - - [13/Nov/2026:10:00:01 +0000] "POST /c/${short}/home HTTP/1.1" 502 157 "-" "curl" "-"`,
 `172.18.0.1 - - [13/Nov/2026:10:00:02 +0000] "${short} /${long} HTTP/1.1" 400 0 "-" "-" "-"`,
 `2026/11/13 10:00:01 [error] 29#29: *1 connect() failed (111: Connection refused) while connecting to upstream, client: 172.18.0.1, server: , request: "POST /c/${short}/home HTTP/1.1", upstream: "http://172.18.0.5:3000/c/${short}/home", host: "${short}.example"`,
 `2026/11/13 10:00:02 [error] 29#29: *2 upstream timed out (110: Connection timed out) while reading response header from upstream, client: ${long}`,
 ''
].join('\n');
// The only shapes a summary line may take: fixed words, known names, numbers.
const grammar=/^(web|gateway) (lines \d+ recognised \d+|request (GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|other) [a-z0-9_\-[\].]+ \d{3}|error [A-Za-z]+|code [A-Z0-9_]+|at [a-zA-Z0-9_\-./[\]@]+(:\d{1,7}:\d{1,7})?|gateway [a-z-]+|install-env ([A-Z_]+|other)|ready) x\d+$/;
const leaked=text=>markers.filter(marker=>text.includes(marker));

function sandbox(t) {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-install-diagnostics-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','lib','bin','app/sign-in','app/c/[slug]']) mkdirSync(join(directory,folder),{recursive:true});
 for(const file of ['scripts/install-diagnostics.sh','scripts/log-summary.mjs','lib/install-env.mjs','lib/settings.mjs','package.json']) copyFileSync(file,join(directory,file));
 // The real install has this file; here it holds no secret, since the summary never reads it.
 writeFileSync(join(directory,'.env.install'),'APP_ORIGIN=http://localhost:3000\n',{mode:0o600});
 // Docker stands in: `compose logs` prints the marker log, a node container runs the summary here with its mount mapped,
 // and every call is recorded so the order of diagnostics and teardown can be read back.
 writeFileSync(join(directory,'bin/docker'),`#!${process.execPath}
const {appendFileSync}=require('node:fs'); const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2); appendFileSync(process.env.COMMANDS,args.join(' ')+'\\n');
if(args[0]==='info') process.exit(0);
if(args.includes('compose')&&args.includes('logs')) { if(process.env.LOGS_EXIT) { process.stderr.write('compose failed '+process.env.LEAK+'\\n'); process.exit(Number(process.env.LOGS_EXIT)); } require('node:fs').writeSync(1,process.env['LOG_'+args.at(-1)]||''); process.exit(0); }
const mount=args.find(arg=>arg.endsWith(':/install:ro'));
if(args.includes('run')&&mount) {
 const source=mount.slice(0,-':/install:ro'.length), at=args.indexOf('node',args.findIndex(arg=>arg.startsWith('node:')));
 const result=spawnSync(process.execPath,args.slice(at+1).map(arg=>arg.replace(/^\\/install/,source)),{stdio:'inherit'});
 process.exit(result.status ?? 1);
}
process.exit(0);
`,{mode:0o755});
 const commands=join(directory,'commands'); writeFileSync(commands,'');
 const run=(script,extra={})=>spawnSync('bash',['--noprofile','--norc','-eo','pipefail','-c',script],{cwd:directory,encoding:'utf8',
  env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,LOG_web:webLog,LOG_gateway:gatewayLog,LEAK:long,...extra}});
 const summary=(service,input,args=[service,'app','package.json'])=>spawnSync(process.execPath,['scripts/log-summary.mjs',...args],{cwd:directory,input,encoding:'utf8'});
 return {directory,commands,run,summary};
}

test('the summary prints only fixed fields, enough to place an HTTP 500, and no marker secret in any form', t => {
 const {summary}=sandbox(t);
 const web=summary('web',webLog), gateway=summary('gateway',gatewayLog);
 for(const result of [web,gateway]) {
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(leaked(result.stdout+result.stderr),[]);
  for(const line of result.stdout.trim().split('\n')) assert.match(line,grammar);
 }
 for(const line of ['web ready x1','web error TypeError x1','web at .next/server/app/sign-in/page.js:1:2345 x1','web at .next/server/chunks/948.js:12:40 x1',
  'web at node_modules/@supabase/supabase-js x1','web at node-internal x1','web at other x4','web error other x1','web code ECONNREFUSED x1','web code PGRST301 x1',
  'web install-env SUPABASE_JWT_SECRET x1','web install-env other x1']) assert.ok(web.stdout.split('\n').includes(line),`missing: ${line}\n${web.stdout}`);
 for(const line of ['gateway request GET sign-in 500 x1','gateway request POST c 502 x1','gateway request other other 400 x1','gateway gateway upstream-refused x1','gateway gateway upstream-timeout x1'])
  assert.ok(gateway.stdout.split('\n').includes(line),`missing: ${line}\n${gateway.stdout}`);
 assert.match(web.stdout,/^web lines 18 recognised \d+ x1$/m);
});

test('the summary prints nothing when it cannot read what it checks against', t => {
 const {summary}=sandbox(t);
 for(const args of [['web','missing-app','package.json'],['web','app','missing.json'],['database','app','package.json'],[]]) {
  const result=summary(args[0],webLog,args);
  assert.notEqual(result.status,0);
  assert.equal(result.stdout,'');
  assert.deepEqual(leaked(result.stderr),[]);
 }
});

test('a failed install check prints the web and gateway summaries before teardown and keeps its exit status', t => {
 const {commands,run,directory}=sandbox(t);
 const step=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install.steps.find(step=>step.env?.INSTALL_REF);
 const lines=step.run.split('\n'), trap=lines.findIndex(line=>line.startsWith('trap '));
 assert.ok(trap>0,'the install step sets an EXIT trap');
 const until=code=>`${lines.slice(0,trap+1).join('\n')}\nexit ${code}\n`;

 const failed=run(until(7));
 assert.equal(failed.status,7,failed.stderr);
 assert.match(failed.stderr,/^gateway request GET sign-in 500 x1$/m);
 assert.match(failed.stderr,/^web error TypeError x1$/m);
 assert.deepEqual(leaked(failed.stdout+failed.stderr),[]);
 const order=readFileSync(commands,'utf8').split('\n');
 const at=pattern=>order.findIndex(line=>pattern.test(line));
 assert.ok(at(/compose .*logs .*web$/)>=0 && at(/compose .*logs .*gateway$/)>=0,'web and gateway logs are read');
 assert.ok(at(/compose .*logs .*gateway$/)<at(/rm -fv install-docker/),'logs are read before the install is torn down');

 writeFileSync(commands,'');
 const passed=run(until(0));
 assert.equal(passed.status,0,passed.stderr);
 assert.doesNotMatch(readFileSync(commands,'utf8'),/logs/);
 assert.match(readFileSync(commands,'utf8'),/rm -fv install-docker/);

 // Diagnostics that cannot run never print a raw log and never change the status.
 rmSync(join(directory,'app'),{recursive:true});
 const unreadable=run(until(3),{LOGS_EXIT:'1'});
 assert.equal(unreadable.status,3,unreadable.stderr);
 assert.deepEqual(leaked(unreadable.stdout+unreadable.stderr),[]);
 assert.match(unreadable.stderr,/web summary unavailable/);
});
