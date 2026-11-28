import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';

// `gtmworks company password-link` (#955, ADR 0019): the install owner names a Company and an Administrator's email, and
// the command prints that Administrator's password link, the way back in for a Company's last Administrator and for the
// install owner, whose link no Administrator makes from the Team page (#915). It refuses a Company the install does not
// have, an email no Person has and a Person who is not an Administrator of that Company; only the secret's hash reaches
// the database, and the secret appears only in the printed link, never in a log.
const fakeDocker=`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
printf 'Password link for person@example.com in "Held Company": http://localhost:3000/password#code=${'a'.repeat(64)}\\n'
`;
function install(t,{env}={}) {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-company-password-link-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 writeFileSync(join(directory,'.env.install'),'');
 writeFileSync(join(directory,'bin/docker'),fakeDocker,{mode:0o755});
 const commands=join(directory,'commands');
 const run=(...args)=>spawnSync('sh',['scripts/install.sh',...args],{cwd:directory,env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,...env},encoding:'utf8'});
 const lines=()=>{ try { return readFileSync(commands,'utf8').trimEnd().split('\n').filter(Boolean); } catch { return []; } };
 return {directory,run,lines};
}

test('company password-link asks the web container for one Administrator\'s link and prints only it', t => {
 const installDir=install(t);
 const result=installDir.run('company','password-link','Held Company','--email','person@example.com');
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(installDir.lines(),['compose --env-file .env.install -f docker-compose.install.yml exec -T web node scripts/company-password-link.mjs --company Held Company --email person@example.com']);
 assert.match(result.stdout,/^Password link for person@example\.com in "Held Company": http:\/\/localhost:3000\/password#code=a{64}\n$/);
});

test('company password-link needs a Company and an email, and refuses while a restore runs', async t => {
 const installDir=install(t);
 for(const args of [['password-link'],['password-link','Held Company'],['password-link','Held Company','--email']]) {
  const refused=installDir.run('company',...args);
  assert.notEqual(refused.status,0,args.join(' '));
  assert.match(refused.stderr,/Usage: gtmworks company add/,args.join(' '));
 }
 assert.deepEqual(installDir.lines(),[],'a refused usage asked Docker for nothing');
 // A password link written between a restore's safety backup and its replacement would stop working, or bring back an
 // older one: the command refuses while a restore holds its marker, as `company link` does.
 const holder=spawn('sh',['-c','exec 8>>.install-restore; flock -n 8 || exit 1; echo held; exec sleep 60'],{cwd:installDir.directory});
 t.after(()=>{ holder.kill('SIGKILL'); holder.stdout.destroy(); holder.unref(); });
 await new Promise(resolve=>holder.stdout.once('data',resolve));
 const refused=installDir.run('company','password-link','Second Company','--email','person@example.com');
 assert.equal(refused.status,1,refused.stderr);
 assert.match(refused.stderr,/^A restore is running: wait for it to finish, then run this again\.$/m);
 assert.deepEqual(installDir.lines(),[],'the refused link asked Docker for nothing');
});

// The Supabase server the script talks to, with the Company rows, the Person's Auth and people rows, and the one call
// that makes the link. Every request is kept, so a test can read what reached the database.
function supabase(t,{companies=[{id:'c1',name:'First Company'}],users=[{id:'p1',email:'admin@example.com'}],person={id:'p1'},rpcStatus=200,rpcBody='"link-id"'}={}) {
 const requests=[];
 const server=createServer((request,response)=>{
  let body='';
  request.on('data',chunk=>{ body+=chunk; });
  request.on('end',()=>{
   requests.push({method:request.method,url:String(request.url),body});
   response.setHeader('Content-Type','application/json');
   if(String(request.url).startsWith('/auth/v1/admin/users')) return response.end(JSON.stringify({users}));
   if(String(request.url).startsWith('/rest/v1/people')) return response.end(JSON.stringify(person));
   if(String(request.url).startsWith('/rest/v1/companies')) return response.end(JSON.stringify(companies));
   if(String(request.url).startsWith('/rest/v1/rpc/make_administrator_password_link')) {
    response.writeHead(rpcStatus); return response.end(rpcBody);
   }
   response.writeHead(404); response.end('{}');
  });
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{
  t.after(()=>new Promise(done=>{ server.closeAllConnections(); server.close(done); }));
  resolve({url:`http://127.0.0.1:${server.address().port}`,requests});
 }));
}
function command(t,server,args) {
 return new Promise(resolve=>{
  const child=spawn(process.execPath,['scripts/company-password-link.mjs',...args],
   {env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:server.url,SUPABASE_SERVICE_ROLE_KEY:'service-role',APP_ORIGIN:'https://app.example.test'}});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{ stdout+=chunk; });
  child.stderr.on('data',chunk=>{ stderr+=chunk; });
  child.on('exit',status=>resolve({status,stdout,stderr}));
 });
}

test('the command prints the Administrator\'s link once, names the Company and the address, and sends only its hash', async t => {
 const server=await supabase(t);
 const answer=await command(t,server,['--company','First Company','--email','ADMIN@example.com']);
 assert.equal(answer.status,0,answer.stderr);
 const link=answer.stdout.match(/^Password link for admin@example\.com in "First Company": (https:\/\/app\.example\.test\/password#code=[a-f0-9]{64})\n$/);
 assert.ok(link,answer.stdout);
 assert.equal(answer.stderr,'','the link is the only thing printed');
 const secret=link[1].slice(link[1].indexOf('#code=')+6);
 assert.equal(link[1].slice(0,link[1].indexOf('#')).includes(secret),false,'nothing before # names the secret');
 // Only the secret's hash reached the database, and the link is the one thing that holds the secret.
 const call=server.requests.find(request=>request.url.startsWith('/rest/v1/rpc/make_administrator_password_link'));
 assert.ok(call,server.requests.map(request=>request.url).join('\n'));
 const argument=JSON.parse(call.body);
 assert.equal(argument.c,'c1');
 assert.equal(argument.person,'p1');
 assert.equal(argument.link_hash,createHash('sha256').update(secret).digest('hex'));
 assert.equal(call.body.includes(secret),false,'the secret itself never reaches the database');
 // A Company is named by its id as it is by its name.
 const byId=await command(t,server,['--company','c1','--email','admin@example.com']);
 assert.equal(byId.status,0,byId.stderr);
 assert.match(byId.stdout,/^Password link for admin@example\.com in "First Company": /);
});

test('the command refuses an unknown Company, an ambiguous name, an unknown email, and a Person who is not an Administrator', async t => {
 const unknown=await supabase(t,{companies:[]});
 const missing=await command(t,unknown,['--company','Nope','--email','admin@example.com']);
 assert.notEqual(missing.status,0);
 assert.equal(missing.stderr,'No Company in this install is named Nope. Pass the Company\'s id or its exact name.\n');
 assert.equal(missing.stdout,'');
 const twice=await supabase(t,{companies:[{id:'c1',name:'Same'},{id:'c2',name:'Same'}]});
 const ambiguous=await command(t,twice,['--company','Same','--email','admin@example.com']);
 assert.notEqual(ambiguous.status,0);
 assert.equal(ambiguous.stderr,'More than one Company in this install is named Same. Pass the Company\'s id instead.\n');
 const nobody=await supabase(t,{users:[]});
 const unknownEmail=await command(t,nobody,['--company','First Company','--email','nobody@example.com']);
 assert.notEqual(unknownEmail.status,0);
 assert.equal(unknownEmail.stderr,'No Person on this install has the email nobody@example.com. Nothing was changed.\n');
 assert.equal(unknownEmail.stdout,'');
 const member=await supabase(t,{rpcStatus:400,rpcBody:'{"code":"42501","message":"passwordLinkNotAdministrator","details":null,"hint":null}'});
 const refused=await command(t,member,['--company','First Company','--email','admin@example.com']);
 assert.notEqual(refused.status,0);
 assert.equal(refused.stderr,'admin@example.com is not an Administrator of "First Company". Nothing was changed.\n');
 assert.equal(refused.stdout,'','a refused link prints no link');
 for(const server of [unknown,twice,nobody,member]) {
  assert.equal(server.requests.some(request=>request.url.startsWith('/rest/v1/rpc/make_administrator_password_link')),server===member,'only the Administrator case asks the database to make a link');
 }
});

test('the runtime image carries the command, as it carries the other Company commands', () => {
 const dockerfile=readFileSync('Dockerfile','utf8');
 assert.match(dockerfile,/^COPY --from=build --chown=node:node \/app\/scripts\/install-engine\.mjs \/app\/scripts\/company-add\.mjs \/app\/scripts\/company-list\.mjs \/app\/scripts\/company-password-link\.mjs \.\/scripts\/$/m);
});

test('the command\'s source logs no secret and sends only the hash to the one server function', () => {
 const source=readFileSync('scripts/company-password-link.mjs','utf8');
 assert.match(source,/linkSecretHash\(secret\)/);
 assert.doesNotMatch(source,/link_hash:\s*secret\b/);
 assert.doesNotMatch(source,/console\.log/,'the link is written once, to stdout, and nowhere else');
 assert.match(source,/process\.stdout\.write\(`Password link for \$\{person\.email\} in "\$\{named\[0\]\.name\}": \$\{passwordLink\(appUrl\('\/'\)\.origin,secret\)\}/);
});
