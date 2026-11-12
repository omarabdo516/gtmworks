import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
test('agent work glossary defines every agreed term in English and Arabic', () => {
 const glossary=readFileSync('GLOSSARY.md','utf8');
 for(const [english,arabic] of [['Agent','وكيل'],['Run','تشغيل'],['Version','نسخة'],['Approval','موافقة'],['Project','مشروع'],['Routine','مهمة متكررة'],['Skill','مهارة'],['Connection','ربط'],['Inbox','الوارد']]) {
  assert.ok(glossary.includes(`**${english} / ${arabic}**:`), `${english} / ${arabic}`);
 }
});
test('UI source uses the glossary term for cards', () => {
 for(const directory of ['app','lib','components','src','worker','supabase/migrations'].filter(existsSync)) {
  for(const file of readdirSync(directory,{recursive:true}).filter(file=>/\.(?:[cm]?[jt]sx?|css|html|json|sql)$/.test(file))) {
   assert.doesNotMatch(readFileSync(`${directory}/${file}`,'utf8'),/كارت|كروت/,`${directory}/${file}`);
  }
 }
});

test('card creation allows editing roles only', async () => {
 const {canCreateCard}=await import('../lib/card-permissions.mjs');
 for(const role of ['owner','manager','contributor']) assert.equal(canCreateCard({role}),true,role);
 for(const role of ['reviewer','viewer','unknown','',undefined]) assert.equal(canCreateCard({role}),false,role);
 // The removed Agency access (ADR 0012) grants nothing: only the Role decides.
 for(const role of ['viewer','unknown','',undefined]) assert.equal(canCreateCard(/** @type {any} */({role,agencyAccess:true})),false,role);
});

test('app motion contains no broad transitions or page entrance animations', () => {
 for (const file of readdirSync('app', {recursive:true}).filter(file => /\.(?:css|tsx)$/.test(file))) {
  assert.doesNotMatch(readFileSync(`app/${file}`, 'utf8'), /transition\s*:\s*all\b|work-enter|work-in|view-transition|420ms|veil-out|card-close|modal-wrap\.closing/, file);
 }
});
test('the four roles and independent grants are documented', () => {
 const glossary=readFileSync('GLOSSARY.md','utf8');
 assert.ok(!/reviewer/i.test(glossary),'the reviewer Role is gone');
 for(const value of ['Owner, Manager, Contributor, or Viewer','publishing, money figures, or customer data']) assert.ok(glossary.includes(value));
});
test('schema prevents contributor and viewer approval', () => {
 const sql=readFileSync('supabase/migrations/20261104000000_foundation.sql','utf8');
 assert.match(sql,/role in \('contributor','viewer'\).*permission in \('approve','reject'\)/);
});
test('local Supabase enables TOTP enrollment and verification', () => {
 const config=readFileSync('supabase/config.toml','utf8');
 const section=config.split(/^\[auth\.mfa\.totp\][ \t]*$/m)[1]?.split(/^\[/m)[0];
 assert.ok(section, 'the TOTP configuration section exists');
 assert.match(section,/^enroll_enabled\s*=\s*true\s*$/m);
 assert.match(section,/^verify_enabled\s*=\s*true\s*$/m);
});

test('work dates use Arabic month names and day-first western digits', async () => {
 const {workDate}=await import('../lib/work-date.mjs');
 assert.equal(workDate('2032-11-12T12:00:00Z','ar'),'12 نوفمبر');
 assert.equal(workDate('2032-11-12T00:00:00Z','ar'),'12 نوفمبر');
 assert.equal(workDate(null,'ar'),'بدون موعد');
 assert.equal(workDate('not a date','ar'),'بدون موعد');
});


test('work list sorts stages by position and actors by name', async () => {
 const {sortWorkCards}=await import('../lib/work-sort.mjs');
 const cards=[{title:'أ',stage_id:2,next_actor:'a',channel:'',go_live:null},{title:'ب',stage_id:12,next_actor:'z',channel:'',go_live:null}];
 const stages=[{id:2,position:8},{id:12,position:1}];
 const members=[{person_id:'a',people:{name:'يوسف'}},{person_id:'z',people:{name:'أحمد'}}];
 assert.deepEqual(sortWorkCards(cards,'stage_id','ascending',stages,members).map(c=>c.stage_id),[12,2]);
 assert.deepEqual(sortWorkCards(cards,'stage_id','descending',stages,members).map(c=>c.stage_id),[2,12]);
 assert.deepEqual(sortWorkCards(cards,'next_actor','ascending',stages,members).map(c=>c.next_actor),['z','a']);
 assert.deepEqual(cards.map(c=>c.stage_id),[2,12]);
});

test('agent API contract lists the implemented operations and idempotency header', () => {
 const route=readFileSync('app/api/v1/companies/[slug]/[...path]/route.ts','utf8');
 const api=readFileSync('docs/api/openapi.yaml','utf8');
 for(const operation of ['move','actor','assignee','label','check','comment']) {
  assert.ok(route.includes(`'${operation}'`));
  assert.match(api,new RegExp(`\\b${operation}\\b`));
 }
 assert.match(api,/Idempotency-Key/);
 assert.match(route,/idempotency-key/);
});

test('key hashes and authenticated secret encryption', async () => {
 const {hashKey,encryptSecret,decryptSecret}=await import('../lib/agent-crypto.mjs');
 assert.equal(hashKey('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 const key=Buffer.alloc(32,7).toString('base64'); const encrypted=encryptSecret('webhook-secret',key);
 assert.notEqual(encrypted,'webhook-secret'); assert.equal(decryptSecret(encrypted,key),'webhook-secret');
 assert.throws(()=>decryptSecret(encrypted,Buffer.alloc(32,8).toString('base64')));
});
test('agent and run keys carry a prefix, are shown once and are stored as a hash that is compared in constant time', async () => {
 const {newKey,hashKey,sameHash}=await import('../lib/agent-crypto.mjs');
 const agent=newKey('agent'); const run=newKey('run');
 assert.match(agent.key,/^gtmw_agt_[A-Za-z0-9_-]{43}$/); assert.match(run.key,/^gtmw_run_[A-Za-z0-9_-]{43}$/);
 assert.equal(agent.hash,hashKey(agent.key)); assert.match(run.hash,/^[0-9a-f]{64}$/); assert.notEqual(newKey('run').key,run.key);
 assert.ok(!JSON.stringify(Object.keys(agent)).includes('secret') && agent.hash!==agent.key);
 assert.equal(sameHash(agent.hash,hashKey(agent.key)),true); assert.equal(sameHash(agent.hash,run.hash),false);
 assert.equal(sameHash(agent.hash,agent.hash.slice(1)),false); assert.equal(sameHash(undefined,agent.hash),false);
 const auth=readFileSync('lib/agent-auth.ts','utf8');
 assert.match(auth,/sameHash\(hash, identity\.key_hash\)/); assert.doesNotMatch(auth,/identity\.kind !== kind\) return \{/);
});
test('HMAC signature signs the exact webhook bytes', async () => {
 const {signature}=await import('../lib/agent-crypto.mjs');
 assert.equal(signature('key','The quick brown fox jumps over the lazy dog'),'sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
 assert.notEqual(signature('key','{}'),signature('key','{ }'));
});
test('webhook retries back off and expire after 24 hours', async () => {
 const {retryAt}=await import('../lib/agent-crypto.mjs'); const now=Date.parse('2030-01-01T00:00:00Z');
 assert.equal(Date.parse(retryAt(new Date(now).toISOString(),1,now)),now+2000);
 assert.equal(Date.parse(retryAt(new Date(now).toISOString(),20,now)),now+3600000);
 assert.equal(retryAt(new Date(now).toISOString(),1,now+86400000-1000),null);
});
test('idempotency fingerprints distinguish method, path, and body', async () => {
 const {fingerprint}=await import('../lib/agent-crypto.mjs');
 const original=fingerprint('POST','cards','{}'); assert.equal(original,fingerprint('POST','cards','{}'));
 for(const other of [fingerprint('PATCH','cards','{}'),fingerprint('POST','cards/1','{}'),fingerprint('POST','cards','{"a":1}')]) assert.notEqual(original,other);
});
test('rate window permits 120 and resets after a minute', async () => {
 const {rateWindow}=await import('../lib/agent-crypto.mjs');
 assert.deepEqual(rateWindow(0,119,59999),{start:0,count:120,limited:false});
 assert.deepEqual(rateWindow(0,120,59999),{start:0,count:121,limited:true});
 assert.deepEqual(rateWindow(0,120,60000),{start:60000,count:1,limited:false});
});
test('revocation is checked during lookup and key material is hashed before persistence', () => {
 const schema=readFileSync('supabase/migrations/20261108000000_agents.sql','utf8');
 const action=readFileSync('app/c/[slug]/[[...section]]/agent-actions.ts','utf8');
 assert.match(schema,/k\.revoked_at is null/); assert.match(action,/newKey\('agent'\)/); assert.match(action,/key_hash:hash\b/);
});

test('webhook worker signs delivery and records retry on HTTP failure', async () => {
 const {deliverBatch}=await import('../worker/webhooks.mjs');
 const {encryptSecret,signature}=await import('../lib/agent-crypto.mjs');
 const encryptionKey=Buffer.alloc(32,9).toString('base64'); const updates=[];
 const job={id:7,company_id:'company',attempts:0,created_at:new Date().toISOString(),event:{card_path:'/c/test/work/board/1',event_type:'rejected',reason:'fix'}};
 const db={rpc:async()=>({data:[job]}),from(){return {select(){return {eq(){return {single:async()=>({data:{url:'http://receiver.test',secret_encrypted:encryptSecret('secret',encryptionKey)}})}}}},update(value){updates.push(value);return {eq(){return {eq:async()=>({error:null})}}}}}}};
 let request; await deliverBatch(db,{encryptionKey,origin:'https://example.test',fetch:async(url,options)=>{request={url,...options};return {ok:false,status:503}}});
 assert.equal(request.headers['X-GTMWorks-Signature'],signature('secret',request.body));
 assert.equal(JSON.parse(request.body).card_url,'https://example.test/c/test/work/board/1');
 assert.equal(updates[0].status,'pending'); assert.equal(updates[0].attempts,1); assert.equal(updates[0].last_status,503); assert.ok(updates[0].next_attempt_at);
});

test('webhook worker issues a run key for an assignment and sends it once, signed', async () => {
 const {deliverBatch}=await import('../worker/webhooks.mjs');
 const {encryptSecret,hashKey,signature}=await import('../lib/agent-crypto.mjs');
 const encryptionKey=Buffer.alloc(32,9).toString('base64'); const calls=[];
 const job={id:8,company_id:'company',card_id:5,attempts:0,created_at:new Date().toISOString(),event:{card_path:'/c/test/work/board/5',event_type:'assigned',agent:{id:'agent-1',name:'Writer'}}};
 const config={url:'https://receiver.test',secret_encrypted:encryptSecret('secret',encryptionKey)};
 const db={
  rpc:async(name,args)=>{calls.push([name,args]);return name==='claim_webhook_deliveries'?{data:[job]}:{data:'2026-11-09T10:00:00Z'};},
  from:()=>({select:()=>({eq:()=>({single:async()=>({data:config})})}),update:()=>({eq:()=>({eq:async()=>({error:null})})})}),
 };
 let request; await deliverBatch(db,{encryptionKey,origin:'https://example.test',fetch:async(url,options)=>{request={url,...options};return {ok:true,status:200}}});
 const sent=JSON.parse(request.body); const issue=calls.find(([name])=>name==='issue_run_key_for')[1];
 assert.match(sent.run_key.key,/^gtmw_run_/); assert.equal(sent.run_key.expires_at,'2026-11-09T10:00:00Z');
 assert.equal(issue.hash,hashKey(sent.run_key.key)); assert.equal(issue.agent,'agent-1'); assert.equal(issue.card,5); assert.equal(request.headers['X-GTMWorks-Signature'],signature('secret',request.body));
 assert.ok(!JSON.stringify(calls).includes(sent.run_key.key),'the key itself never reaches the database call');
});

test('webhook worker never sends a run key over plain HTTP', async () => {
 const {deliverBatch}=await import('../worker/webhooks.mjs');
 const {encryptSecret}=await import('../lib/agent-crypto.mjs');
 const encryptionKey=Buffer.alloc(32,9).toString('base64'); const calls=[]; const updates=[]; let sent=false;
 const job={id:9,company_id:'company',card_id:5,attempts:0,created_at:new Date().toISOString(),event:{card_path:'/c/test/work/board/5',event_type:'assigned',agent:{id:'agent-1',name:'Writer'}}};
 const config={url:'http://receiver.example',secret_encrypted:encryptSecret('secret',encryptionKey)};
 const db={
  rpc:async(name,args)=>{calls.push(name);return name==='claim_webhook_deliveries'?{data:[job]}:{data:'2026-11-09T10:00:00Z'};},
  from:()=>({select:()=>({eq:()=>({single:async()=>({data:config})})}),update:value=>{updates.push(value);return {eq:()=>({eq:async()=>({error:null})})};}}),
 };
 await deliverBatch(db,{encryptionKey,origin:'https://example.test',fetch:async()=>{sent=true;return {ok:true,status:200};}});
 assert.equal(sent,false); assert.ok(!calls.includes('issue_run_key_for')); assert.equal(updates[0].last_error,'runKeyHttpsOnly');
});

test('OpenAPI paths and methods match the exposed card routes', async () => {
 const {load}=await import('js-yaml');
 const spec=load(readFileSync('docs/api/openapi.yaml','utf8'));
 const route=readFileSync('app/api/v1/companies/[slug]/[...path]/route.ts','utf8');
 const implemented=Object.keys(spec.paths).filter(path=>spec.paths[path]['x-status']!=='planned');
 assert.deepEqual(implemented.sort(),['/cards','/cards/{card}','/cards/{card}/comment','/cards/{card}/files/{file}','/cards/{card}/run-keys','/cards/{card}/upload','/cards/{card}/{operation}','/skill-loads','/skills','/skills/{skill}/lessons'].sort());
 for(const [path,method] of [['/cards','get'],['/cards','post'],['/cards/{card}','patch'],['/cards/{card}/upload','post'],['/cards/{card}/comment','post'],['/cards/{card}/{operation}','post'],['/cards/{card}/files/{file}','get']]) assert.ok(spec.paths[path][method],`${method} ${path}`);
 assert.match(route,/path\[2\]==='files'/);
 const allowed=route.match(/\['create','edit',([^\]]+)\]\.includes\(op\)/)?.[1].match(/[a-z]+/g);
 const documented=spec.paths['/cards/{card}/{operation}'].parameters.find(p=>p.name==='operation').schema.enum;
 assert.deepEqual([...allowed].sort(),[...documented].sort());
 assert.match(route,/path\[2\]==='upload'/);
});

test('agent contract distinguishes planned run authority from current company keys', async () => {
 const {load}=await import('js-yaml');
 const spec=load(readFileSync('docs/api/openapi.yaml','utf8'));
 assert.equal(spec.info.version,'1.6.0');
 for(const path of ['/cards/{card}/runs','/runs/{run}/claim','/runs/{run}/heartbeat','/runs/{run}/complete']) {
  const endpoint=spec.paths[path];
  assert.equal(endpoint?.['x-status'],'planned',path);
  assert.match(endpoint.post.description,/not implemented/i);
 }
 const [json,request]=spec.paths['/cards'].post.requestBody.content['application/json'].schema.oneOf;
 assert.deepEqual(json.required,['title','stage']);
 assert.deepEqual(request.required,['message','agent','mode']);
 assert.deepEqual(request.properties.mode.enum,['plan','do','answer']);
 assert.equal(json.properties.stage.type,'integer');
 assert.equal(spec.paths['/cards/{card}/comment'].post.requestBody.content['application/json'].schema.properties.evidence.format,undefined,'evidence is text, not URI-validated');
 assert.ok(spec.paths['/cards'].get.responses.default,'errors documented');
});

test('agent dates use western digits and UTC independent of the host time zone', async () => {
 const {agentDate}=await import('../lib/agent-date.mjs');
 const date=agentDate('2032-11-12T23:15:00Z');
 assert.match(date,/12/); assert.match(date,/2032/); assert.match(date,/11:15/); assert.doesNotMatch(date,/[٠-٩]/);
 assert.equal(agentDate('invalid'),'—');
});

test('production settings report missing names and reject unsafe values', async () => {
 const {checkSettings,LOCAL_ANON_KEY}=await import('../lib/settings.mjs');
 const env={NODE_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'http://localhost:54321',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-test-key',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_JWT_SECRET:'test-jwt',WEBHOOK_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64'),APP_ORIGIN:'https://example.test'};
 assert.doesNotThrow(()=>checkSettings(env));
 assert.throws(()=>checkSettings({...env,SUPABASE_JWT_SECRET:'',SUPABASE_SERVICE_ROLE_KEY:''}),/SUPABASE_SERVICE_ROLE_KEY.*SUPABASE_JWT_SECRET/);
 assert.throws(()=>checkSettings({...env,NEXT_PUBLIC_SUPABASE_ANON_KEY:LOCAL_ANON_KEY}),/NEXT_PUBLIC_SUPABASE_ANON_KEY.*fallback/);
 assert.throws(()=>checkSettings({...env,APP_ORIGIN:'http://example.test'}),/APP_ORIGIN.*https/);
 assert.throws(()=>checkSettings({...env,WEBHOOK_ENCRYPTION_KEY:'bad'}),/WEBHOOK_ENCRYPTION_KEY/);
});

test('health probes the database anonymously and reports success or failure without secrets', async () => {
 const {health}=await import('../lib/health.mjs');
 let observed;
 const good=await health('https://db.example.test','anon-test',async (url,options)=>{observed={url,options}; return {ok:true};});
 assert.deepEqual(good,{ok:true,version:JSON.parse(readFileSync('package.json','utf8')).version,db:true});
 assert.equal(observed.url,'https://db.example.test/rest/v1/companies?select=id&limit=1');
 assert.equal(observed.options.headers.Authorization,'Bearer anon-test');
 for(const probe of [async()=>({ok:false}),async()=>{throw new Error('sensitive details')}]) {
  const bad=await health('https://db.example.test','anon-test',probe);
  assert.deepEqual(bad,{ok:false,version:good.version,db:false});
 }
});

test('health response maps an unreachable database to HTTP 503', async () => {
 const {healthResponse}=await import('../lib/health.mjs');
 const response=await healthResponse('https://db.example.test','anon-test',async()=>{throw new Error('private connection details')});
 assert.equal(response.status,503);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{ok:false,version:JSON.parse(readFileSync('package.json','utf8')).version,db:false});
});

test('production worker exits with all missing setting names', async () => {
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync(process.execPath,['worker/index.mjs'],{env:{NODE_ENV:'production'},encoding:'utf8',timeout:10000});
 assert.notEqual(result.status,0);
 for(const name of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_JWT_SECRET','WEBHOOK_ENCRYPTION_KEY','APP_ORIGIN']) assert.match(result.stderr,new RegExp(name));
});

test('every unavailable Home metric and chart remains unavailable rather than zero', async()=>{
 const {homeCharts,metricValue}=await import('../lib/home-data.mjs');
 const missing=homeCharts(null,null,null);
 assert.deepEqual(missing,{delivered:null,stages:null,acceptance:null});
 for(const source of [null,undefined,...Object.values(missing)]) {
  assert.equal(metricValue(source),'Unavailable');
  assert.notEqual(metricValue(source),'0');
 }
 assert.equal(metricValue(0),'0','a real measured zero remains zero');
});

test('Home charts use fourteen UTC days, actual stages and first acceptance without earlier rejection',async()=>{
 const {homeCharts}=await import('../lib/home-data.mjs');
 const now=Date.parse('2030-01-15T12:00:00Z');
 const stages=[{id:1,name:'كتابة'},{id:2,name:'تم الاعتماد',stage_key:'approved'}];
 const cards=[{id:1,stage_id:1,created_at:'2030-01-02T00:00:00Z'},{id:2,stage_id:2,created_at:'2030-01-01T23:59:59Z'}];
 const delivered=(id,card_id,created_at)=>({id,card_id,created_at,action:'card_changed',details:{field:'stage_id',new:2,new_name:'اسم قديم'}});
 const events=[{id:1,card_id:1,created_at:'2029-12-01T00:00:00Z',action:'approval_rejected',details:{}},delivered(2,1,'2030-01-03T12:00:00Z'),delivered(3,2,'2030-01-15T10:00:00Z'),delivered(4,3,'2030-01-01T23:59:59Z'),delivered(5,4,'2030-01-16T00:00:00Z')];
 const charts=homeCharts(cards,stages,events,now);
 assert.equal(charts.delivered.length,14);
 assert.equal(charts.delivered[0].label,'2030-01-02');
 assert.equal(charts.delivered.at(-1).label,'2030-01-15');
 assert.equal(charts.delivered.reduce((sum,row)=>sum+row.value,0),2);
 assert.deepEqual(charts.stages,[{label:'كتابة',value:1},{label:'تم الاعتماد',value:0}]);
 assert.equal(charts.acceptance,50);
 assert.equal(homeCharts([],stages,[],now).acceptance,null,'no denominator is unavailable');
});

test('catalogues reject missing keys, empty messages and mismatched interpolation', async()=>{
 const {catalogueProblems}=await import('../scripts/check-i18n.mjs');
 assert.deepEqual(catalogueProblems({hello:'Hello {0}'},{hello:'مرحبًا {0}'}),[]);
 assert.ok(catalogueProblems({hello:'Hello'},{}).length);
 assert.ok(catalogueProblems({},{hello:'مرحبًا'}).length);
 assert.ok(catalogueProblems({hello:'Hello'},{hello:''}).length);
 assert.ok(catalogueProblems({hello:'Hello {0}'},{hello:'مرحبًا {1}'}).length);
});
test('UI literal guard parses JSX text, expressions and user-facing attributes', async()=>{
 const {literalProblems}=await import('../scripts/check-i18n.mjs');
 for(const source of ['<p>Hello</p>','<p>مرحبًا</p>','<p>{"Hello"}</p>','<p>{ok?"Yes":"No"}</p>','<p>{`Welcome ${name}`}</p>','<input placeholder="Email"/>','<img alt={ok?"One":"Two"}/>','<button aria-label={`Open ${name}`}/>','<p title={"Details"}/>']) assert.ok(literalProblems('app/example.tsx',source).length,source);
 assert.deepEqual(literalProblems('app/example.tsx','<p className="panel" dir="auto" title={title}>{t("hello",name)}{content}</p>'),[]);
});
test('selected language controls formatting with Western digits and catalogues pass the guard', async()=>{
 const {i18n}=await import('../lib/i18n.mjs');
 const {workDate}=await import('../lib/work-date.mjs');
 const {agentDate}=await import('../lib/agent-date.mjs');
 const {checkI18n}=await import('../scripts/check-i18n.mjs');
 assert.deepEqual(checkI18n(),[]);
 assert.equal(i18n().language,'en');
 assert.equal(i18n('ar').t('movedTheCardFromTo','كتابة','مراجعة'),'نقل البطاقة من كتابة إلى مراجعة');
 assert.equal(workDate('2032-11-12T12:00:00Z'),'November 12');
 assert.equal(workDate(null),'No date');
 const {metricValue}=await import('../lib/home-data.mjs');
 assert.equal(metricValue(null,'ar'),'غير متاح');
 assert.equal(metricValue(1234,'en'),'1,234');
 assert.equal(metricValue(1234,'ar'),'1,234');
 for(const language of ['en','ar']) {
  assert.match(new Intl.NumberFormat(i18n(language).locale).format(1234),/1.*234/);
  assert.doesNotMatch(agentDate('2032-11-12T12:00:00Z',language),/[٠-٩]/);
 }
});

test('Paperclip copies ship the pinned MIT notice and a complete per-file inventory', () => {
 const notice=readFileSync('THIRD_PARTY_NOTICES.md','utf8');
 assert.match(notice,/Copyright \(c\) 2025 Paperclip AI/);
 assert.match(notice,/dc1adb7209bf8077983fdde8c1e8ab18405403b7/);
 assert.match(notice,/Permission is hereby granted, free of charge/);
 assert.match(notice,/THE SOFTWARE IS PROVIDED "AS IS"/);
 const files=readdirSync('components/paperclip',{recursive:true}).filter(file=>statSync(`components/paperclip/${file}`).isFile()).map(file=>`components/paperclip/${file}`).sort();
 const listed=[...notice.matchAll(/^\| `(components\/paperclip\/[^`]+)` \|/gm)].map(match=>match[1]).sort();
 assert.ok(files.length>0);
 assert.deepEqual(listed,files,'each copied file is listed exactly once');
});

test('the retired palette and display font are absent from shipped UI and design sources', () => {
 const retiredFont=['thman','yah'].join('');
 const grep=spawnSync('git',['grep','-in','-e',retiredFont,'--',':/'],{encoding:'utf8'});
 assert.equal(grep.status,1,grep.stdout||grep.stderr||'literal retired-font grep must have no matches');
 for(const directory of ['app','lib','components','design']) for(const file of readdirSync(directory,{recursive:true})) {
  assert.doesNotMatch(file,new RegExp(retiredFont,'i'));
  if(!/\.(?:tsx?|mjs|css|html)$/.test(file)) continue;
  assert.doesNotMatch(readFileSync(`${directory}/${file}`,'utf8'),new RegExp(String.raw`--(?:bg|panel|line|text|mint|gold)(?![\w-])|#(?:0e171f|101a24|394c5c|e7edf1|bac8d1|a8e1d3|ddc29c)\b|${retiredFont}`,'i'),`${directory}/${file}`);
 }
});

test('a work date with hour and minute shows the same instant in the zone asked for, and in the viewer zone when none is given', async () => {
 const {workDate}=await import('../lib/work-date.mjs');
 const instant='2026-11-09T04:59:00Z', time={hour:'2-digit',minute:'2-digit'};
 assert.match(workDate(instant,'en',{...time,timeZone:'UTC'}),/04:59/);
 assert.match(workDate(instant,'en',{...time,timeZone:'Africa/Cairo'}),/06:59/);
 assert.match(workDate(instant,'ar',{...time,timeZone:'Africa/Cairo'}),/06:59/);
 assert.doesNotMatch(workDate(instant,'ar',{...time,timeZone:'UTC'}),/[٠-٩]/);
 const viewer=new Intl.DateTimeFormat().resolvedOptions().timeZone;
 assert.equal(workDate(instant,'en',{...time,timeZone:undefined}),workDate(instant,'en',{...time,timeZone:viewer}));
 assert.equal(workDate('2026-11-09T04:59:00Z','en'),workDate('2026-11-09T23:59:00Z','en'),'without extras the date is still the UTC day');
});

test('a failed server action writes one structured log line with its name and no secret values', async () => {
 const {withActionLog,logActionFailure,companyContext}=await import('../lib/diagnostics.mjs');
 const env={SUPABASE_SERVICE_ROLE_KEY:'service-role-value-1234',WEBHOOK_ENCRYPTION_KEY:'webhook-key-value-5678',NODE_ENV:'production'};
 const lines=[];

 const form=new FormData(); form.set('company','0b7e3a52-1c4d-4f6a-9b8e-2d5c7f1a3e90'); form.set('slug','rs-learning'); form.set('secret','must-not-appear-in-the-log');
 const changeMember=withActionLog('changeMember',async()=>{ const error=new Error('invite failed for key service-role-value-1234 with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl and code 123456'); error.status=422; throw error; },{write:line=>lines.push(line),env});
 await assert.rejects(changeMember(form),/invite failed/);
 assert.equal(lines.length,1);
 const entry=JSON.parse(lines[0]);
 assert.deepEqual([entry.event,entry.action,entry.outcome,entry.status,entry.errorClass],['server_action_failed','changeMember','threw',422,'Error']);
 assert.match(entry.message,/invite failed for key \[redacted\]/);
 assert.deepEqual([entry.company,entry.slug],['0b7e3a52-1c4d-4f6a-9b8e-2d5c7f1a3e90','rs-learning']);
 for(const secret of ['must-not-appear-in-the-log','service-role-value-1234','webhook-key-value-5678','eyJhbGciOiJIUzI1NiJ9','123456']) assert.ok(!lines[0].includes(secret),secret);
 logActionFailure('saveLanguage',{message:'permission denied',code:'42501'},{write:line=>lines.push(line),env});
 logActionFailure('revokeAgentKey',{message:'no key matched'},{write:line=>lines.push(line),env,form});
 const handled=JSON.parse(lines[2]);
 assert.deepEqual([handled.action,handled.outcome,handled.company,handled.slug],['revokeAgentKey','returned','0b7e3a52-1c4d-4f6a-9b8e-2d5c7f1a3e90','rs-learning']);
 const bad=new FormData(); bad.set('company','not-an-id'); bad.set('slug','Has Spaces and \n newline');
 assert.deepEqual(companyContext(bad),{company:null,slug:null});
 const returned=JSON.parse(lines[1]);
 assert.deepEqual([returned.action,returned.outcome,returned.code,returned.message],['saveLanguage','returned','42501','permission denied']);
});

test('a redirect from a server action is not logged as a failure',async()=>{
 const {withActionLog}=await import('../lib/diagnostics.mjs');
 const lines=[]; const redirect=Object.assign(new Error('NEXT_REDIRECT'),{digest:'NEXT_REDIRECT;replace;/c/x;307;'});
 await assert.rejects(withActionLog('workAction',async()=>{throw redirect;},{write:line=>lines.push(line)})(),redirect);
 assert.deepEqual(lines,[]);
});

test('the client error endpoint logs the message and stack of a page error without secrets, and refuses bad or excess reports',async()=>{
 const {clientErrorResponse,limiter}=await import('../lib/diagnostics.mjs');
 const env={SUPABASE_JWT_SECRET:'jwt-secret-value-9999'};
 const send=(body,options={})=>clientErrorResponse(new Request('http://localhost/api/client-errors',{method:'POST',body:typeof body==='string'?body:JSON.stringify(body),headers:{'user-agent':'test-agent'}}),{env,...options});
 const lines=[];
 const ok=await send({source:'two-step',message:'Failed to fetch jwt-secret-value-9999',stack:'Error: Failed to fetch\n    at check (mfa.tsx:1:1)',path:'/all-brands?code=123456',stage:'verify',status:'0',code:'x'},{write:line=>lines.push(line)});
 assert.equal(ok.status,204);
 assert.equal(lines.length,1);
 const entry=JSON.parse(lines[0]);
 assert.deepEqual([entry.event,entry.source,entry.path,entry.stage,entry.userAgent],['client_error','two-step','/all-brands','verify','test-agent']);
 assert.match(entry.message,/Failed to fetch \[redacted\]/); assert.match(entry.stack,/at check/);
 assert.ok(!lines[0].includes('jwt-secret-value-9999')&&!lines[0].includes('123456'));
 assert.equal((await send('not json',{write:line=>lines.push(line)})).status,400);
 assert.equal((await send({source:'page'},{write:line=>lines.push(line)})).status,400);
 assert.equal((await send({message:'x'.repeat(9000)},{write:line=>lines.push(line)})).status,413);
 assert.equal(lines.length,1);
 let now=0; const allowed=limiter(2,1000,()=>now);
 assert.deepEqual([allowed(),allowed(),allowed()],[true,true,false]); now=1500; assert.equal(allowed(),true);
});

test('every server action is wrapped so a thrown failure is logged',()=>{
 const files=readdirSync('app',{recursive:true}).map(file=>`app/${file}`).filter(file=>/\.tsx?$/.test(file)&&/^'use server'/.test(readFileSync(file,'utf8')));
 assert.ok(files.length>=5,files.join());
 for(const file of files) for(const line of readFileSync(file,'utf8').split('\n').filter(line=>/^export /.test(line))) assert.match(line,/^export const (\w+)=withActionLog\('\1',/,`${file}: ${line.slice(0,60)}`);
});
