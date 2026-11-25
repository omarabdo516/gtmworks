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

// A page fades in as the reference's view does (app/shell.css .app-content.view-enter, #135); the product's older page
// entrances (the work view's slide, the veil, view transitions) stay gone, as does a transition of every property.
test('app motion contains no broad transitions or the old page entrances', () => {
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


// #683: the List sorts by status in the board's order, by assignee and by Project name, a Card with none last.
test('work list sorts by status in the board\'s order, and by assignee and Project name', async () => {
 const {sortWorkCards}=await import('../lib/work-sort.mjs');
 const cards=[{title:'أ',status:'live',assignee_person:'a',assignee_agent:null,project_id:7,go_live:null},{title:'ب',status:'ideas',assignee_person:'z',assignee_agent:null,project_id:null,go_live:null},
  {title:'ج',status:'waiting',assignee_person:null,assignee_agent:'ads',project_id:8,go_live:null},{title:'د',status:'ideas',assignee_person:null,assignee_agent:null,project_id:7,go_live:null}];
 const members=[{person_id:'a',people:{name:'يوسف'}},{person_id:'z',people:{name:'أحمد'}}];
 const agents=[{id:'ads',name:'بلال'}];
 const projects=[{id:7,name:'ربيع'},{id:8,name:'إطلاق'}];
 assert.deepEqual(sortWorkCards(cards,'status','ascending',members).map(c=>c.title),['ج','ب','د','أ']);
 assert.deepEqual(sortWorkCards(cards,'status','descending',members).map(c=>c.title),['أ','ب','د','ج']);
 assert.deepEqual(sortWorkCards(cards,'assignee','ascending',members,agents).map(c=>c.title),['ب','ج','أ','د']);
 assert.deepEqual(sortWorkCards(cards,'project','ascending',members,agents,projects).map(c=>c.title),['ج','أ','د','ب']);
 assert.deepEqual(cards.map(c=>c.title),['أ','ب','ج','د']);
});

test('authenticated secret encryption', async () => {
 const {encryptSecret,decryptSecret}=await import('../lib/agent-crypto.mjs');
 const key=Buffer.alloc(32,7).toString('base64'); const encrypted=encryptSecret('webhook-secret',key);
 assert.notEqual(encrypted,'webhook-secret'); assert.equal(decryptSecret(encrypted,key),'webhook-secret');
 assert.throws(()=>decryptSecret(encrypted,Buffer.alloc(32,8).toString('base64')));
});
test('idempotency fingerprints distinguish method, path, and body', async () => {
 const {fingerprint}=await import('../lib/agent-crypto.mjs');
 const original=fingerprint('POST','cards','{}'); assert.equal(original,fingerprint('POST','cards','{}'));
 for(const other of [fingerprint('PATCH','cards','{}'),fingerprint('POST','cards/1','{}'),fingerprint('POST','cards','{"a":1}')]) assert.notEqual(original,other);
});

test('agent dates use western digits and UTC independent of the host time zone', async () => {
 const {agentDate}=await import('../lib/agent-date.mjs');
 const date=agentDate('2032-11-12T23:15:00Z');
 assert.match(date,/12/); assert.match(date,/2032/); assert.match(date,/11:15/); assert.doesNotMatch(date,/[٠-٩]/);
 assert.equal(agentDate('invalid'),'—');
});

test('production settings report missing names and reject unsafe values', async () => {
 const {checkSettings,LOCAL_ANON_KEY}=await import('../lib/settings.mjs');
 const env={NODE_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'http://localhost:54321',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-test-key',SUPABASE_SERVICE_ROLE_KEY:'test-service',WEBHOOK_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64'),APP_ORIGIN:'https://example.test'};
 assert.doesNotThrow(()=>checkSettings(env));
 assert.throws(()=>checkSettings({...env,WEBHOOK_ENCRYPTION_KEY:'',SUPABASE_SERVICE_ROLE_KEY:''}),/SUPABASE_SERVICE_ROLE_KEY.*WEBHOOK_ENCRYPTION_KEY/);
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
 for(const name of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','WEBHOOK_ENCRYPTION_KEY','APP_ORIGIN']) assert.match(result.stderr,new RegExp(name));
 // The worker signs no token, so it never asks for the JWT secret (#446).
 assert.doesNotMatch(result.stderr,/SUPABASE_JWT_SECRET/);
});

test('every unavailable Home metric and chart remains unavailable rather than zero', async()=>{
 const {homeCharts,metricValue}=await import('../lib/home-data.mjs');
 const missing=homeCharts(null,null);
 assert.deepEqual(missing,{delivered:null,statuses:null,acceptance:null});
 for(const source of [null,undefined,...Object.values(missing)]) {
  assert.equal(metricValue(source),'Unavailable');
  assert.notEqual(metricValue(source),'0');
 }
 assert.equal(metricValue(0),'0','a real measured zero remains zero');
});

// #676: Home reads Approvals and status moves, never stages. A delivery is an Approval that closed a review: its
// decision moved the Card out of review in the same moment (an earlier approval step's Approval moves nothing).
test('Home charts use fourteen days of the Company\'s zone (UTC here), each Card\'s status and first acceptance without earlier rejection',async()=>{
 const {homeCharts}=await import('../lib/home-data.mjs');
 const now=Date.parse('2030-01-15T12:00:00Z');
 const cards=[{id:1,status:'progress',created_at:'2030-01-02T00:00:00Z'},{id:2,status:'planned',created_at:'2030-01-01T23:59:59Z'},{id:3,status:'planned',created_at:'2030-01-10T00:00:00Z'}];
 const approved=(id,card_id,created_at)=>({id,card_id,created_at,action:'approval_approved',details:{step:'مراجعة'}});
 // A row from before the cutover (#684) names the stage; one written since names the status.
 const moved=(id,card_id,created_at,details={field:'stage_id',new:2,new_name:'اسم قديم'})=>({id,card_id,created_at,action:'card_changed',details});
 const events=[{id:1,card_id:1,created_at:'2029-12-01T00:00:00Z',action:'approval_rejected',details:{}},
  approved(2,1,'2030-01-03T12:00:00Z'),moved(3,1,'2030-01-03T12:00:00Z'),
  approved(4,2,'2030-01-15T10:00:00Z'),moved(5,2,'2030-01-15T10:00:00Z',{field:'status',old_status:'waiting',new_status:'planned'}),
  approved(6,3,'2030-01-01T23:59:59Z'),moved(7,3,'2030-01-01T23:59:59Z'),
  approved(8,4,'2030-01-16T00:00:00Z'),moved(9,4,'2030-01-16T00:00:00Z'),
  // An Approval of an earlier step moved nothing: it is no delivery; a move with no Approval is none either.
  approved(10,5,'2030-01-12T00:00:00Z'),moved(11,6,'2030-01-12T08:00:00Z')];
 const charts=homeCharts(cards,events,now,'UTC');
 assert.equal(charts.delivered.length,14);
 assert.equal(charts.delivered[0].label,'2030-01-02');
 assert.equal(charts.delivered.at(-1).label,'2030-01-15');
 assert.equal(charts.delivered.reduce((sum,row)=>sum+row.value,0),2);
 assert.deepEqual(charts.delivered.filter(row=>row.value).map(row=>row.label),['2030-01-03','2030-01-15']);
 assert.deepEqual(charts.statuses,[{label:'waiting',value:0},{label:'ideas',value:0},{label:'planned',value:1},{label:'progress',value:1},{label:'live',value:0},{label:'done',value:0}]);
 assert.equal(charts.acceptance,50);
 assert.equal(homeCharts([],[],now,'UTC').acceptance,null,'no denominator is unavailable');
});

test('an Agent works on its newest Card in progress, never one whose chat waits on a person', async()=>{
 const {currentAgentCard}=await import('../lib/home-data.mjs');
 const cards=[
  {id:1,status:'progress',assignee_agent:'a',created_at:'2030-01-02T00:00:00Z'},
  {id:2,status:'progress',assignee_agent:'a',created_at:'2030-01-03T00:00:00Z'},
  {id:3,status:'progress',assignee_agent:'a',created_at:'2030-01-04T00:00:00Z',wait:{person:'p',kind:'question',title:'Which tone?'}},
  {id:4,status:'planned',assignee_agent:'a',created_at:'2030-01-05T00:00:00Z'},
  {id:5,status:'progress',assignee_agent:'b',created_at:'2030-01-06T00:00:00Z'},
 ];
 assert.equal(currentAgentCard(cards,'a')?.id,2,'the newest Card in progress, not one waiting or in another column');
 assert.equal(currentAgentCard(cards,'b')?.id,5);
 assert.equal(currentAgentCard(cards,'c'),null,'no Card is not a Card');
 assert.equal(currentAgentCard(null,'a'),null,'an unread Card list is unavailable');
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

// Every face is bundled by next/font and served from /_next/static/media (app.spec.ts checks the requests).
test('public contains no font files, including renamed font binaries', () => {
 const files=existsSync('public')?readdirSync('public',{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>`${entry.parentPath}/${entry.name}`):[];
 for(const file of files) {
  assert.doesNotMatch(file,/\.(?:otf|ttf|woff2?|eot|ttc)$/i);
  const head=readFileSync(file).subarray(0,4);
  assert.ok(!['OTTO','wOFF','wOF2','ttcf','true','typ1'].includes(head.toString('ascii'))&&!head.equals(Buffer.from([0,1,0,0])),`${file} is a font`);
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

test('a chat open writes one line of each step\'s whole milliseconds, with ids only',async()=>{
 const {chatOpenLine}=await import('../lib/diagnostics.mjs');
 const entry=JSON.parse(chatOpenLine({company:'0B7E3A52-1c4d-4f6a-9b8e-2d5c7f1a3e90',conversation:'not an id; drop table',steps:{frame:12.4,sidebar:80.6,record:NaN,body:5,done:301}},{now:new Date('2026-11-18T10:00:00Z')}));
 assert.deepEqual(entry,{event:'chat_opened',at:'2026-11-18T10:00:00.000Z',company:'0b7e3a52-1c4d-4f6a-9b8e-2d5c7f1a3e90',conversation:null,render:'open',ms:{frame:12,sidebar:81,done:301}});
 // The kind of render (#762): a prefetch and a refresh say so; anything else is an open.
 assert.equal(JSON.parse(chatOpenLine({company:'x',conversation:'y',steps:{},render:'prefetch'})).render,'prefetch');
 assert.equal(JSON.parse(chatOpenLine({company:'x',conversation:'y',steps:{},render:'refresh'})).render,'refresh');
 assert.equal(JSON.parse(chatOpenLine({company:'x',conversation:'y',steps:{},render:'<script>'})).render,'open');
});

test('an Engine\'s change of state is one line with its cause, and a failed call names why (#772)',async()=>{
 const {engineStateLine}=await import('../lib/diagnostics.mjs');
 const {failureCause}=await import('../lib/hermes.mjs');
 assert.deepEqual(JSON.parse(engineStateLine({engine:'hermes-rs:8642',state:'down',cause:'timedOut'},{now:new Date('2026-11-25T10:00:00Z')})),{event:'engine_state',at:'2026-11-25T10:00:00.000Z',engine:'hermes-rs:8642',state:'down',cause:'timedOut'});
 assert.equal(JSON.parse(engineStateLine({engine:'h',state:'up',cause:'timedOut'})).cause,null);
 assert.equal(JSON.parse(engineStateLine({engine:'h',state:'down',cause:'anything'})).cause,'failed');
 assert.equal(failureCause(Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'})),'timedOut');
 assert.equal(failureCause(Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNREFUSED'}})),'refused');
 assert.equal(failureCause(Object.assign(new TypeError('fetch failed'),{cause:{code:'ENOTFOUND'}})),'nameNotFound');
 assert.equal(failureCause(Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}})),'noNetwork');
 assert.equal(failureCause(new Error('other')),'failed');
});

test('an apps read that failed is one line with its cause, ids only (#770)',async()=>{
 const {appsUnreadLine}=await import('../lib/diagnostics.mjs');
 assert.deepEqual(JSON.parse(appsUnreadLine({company:'0B7E3A52-1c4d-4f6a-9b8e-2d5c7f1a3e90',agent:'x',cause:'refused'},{now:new Date('2026-11-25T10:00:00Z')})),{event:'apps_unread',at:'2026-11-25T10:00:00.000Z',company:'0b7e3a52-1c4d-4f6a-9b8e-2d5c7f1a3e90',agent:null,cause:'refused'});
 assert.equal(JSON.parse(appsUnreadLine({company:'x',agent:'y',cause:'secret text'})).cause,'failed');
});

test('a page render is told apart as an open, a prefetch or a refresh from the router\'s headers (#762)',async()=>{
 const {renderKind}=await import('../lib/diagnostics.mjs');
 const path='/c/rs-learning/conversations/0b7e3a52-1c4d-4f6a-9b8e-2d5c7f1a3e90';
 assert.equal(renderKind(new Headers(),path),'open');
 assert.equal(renderKind(new Headers({rsc:'1','next-router-prefetch':'1',referer:'http://app/c/rs-learning/numbers'}),path),'prefetch');
 assert.equal(renderKind(new Headers({rsc:'1',referer:`http://app${path}`}),path),'refresh');
 assert.equal(renderKind(new Headers({rsc:'1',referer:'http://app/c/rs-learning/numbers'}),path),'open');
 assert.equal(renderKind(new Headers({rsc:'1'}),path),'open');
});

test('what a person waited for is one line each, with ids and whole milliseconds only (#762)',async()=>{
 const {waitLine,waitResponse,senderLimiter}=await import('../lib/diagnostics.mjs');
 const company='0B7E3A52-1c4d-4f6a-9b8e-2d5c7f1a3e90'; const conversation='1b7e3a52-1c4d-4f6a-9b8e-2d5c7f1a3e90';
 const now=new Date('2026-11-25T10:00:00Z');
 assert.deepEqual(JSON.parse(waitLine({event:'message_drawn',company,conversation,ms:41.6,body:'secret words'},{now})),{event:'message_drawn',at:'2026-11-25T10:00:00.000Z',company:company.toLowerCase(),conversation,ms:42});
 assert.deepEqual(JSON.parse(waitLine({event:'run_started',company,conversation,ms:812},{now})),{event:'run_started',at:'2026-11-25T10:00:00.000Z',company:company.toLowerCase(),conversation,ms:812});
 assert.deepEqual(JSON.parse(waitLine({event:'reply_drawn',company,conversation:'not an id',ms:300,from:'stream'},{now})),{event:'reply_drawn',at:'2026-11-25T10:00:00.000Z',company:company.toLowerCase(),conversation:null,ms:300,from:'stream'});
 assert.equal(JSON.parse(waitLine({event:'reply_drawn',company,conversation,ms:300,from:'anything'})).from,'stored');
 assert.equal(waitLine({event:'chat_opened',company,conversation,ms:1}),null);
 assert.equal(waitLine({event:'message_drawn',company,conversation,ms:-1}),null);
 assert.equal(waitLine({event:'message_drawn',company,conversation,ms:Number.NaN}),null);
 // The browser's report: written once, the starter's own line refused, rate-limited as a client error is.
 const lines=[]; const allowed=senderLimiter({perSender:2,ceiling:100});
 const post=body=>waitResponse(new Request('http://localhost/api/waits',{method:'POST',body:JSON.stringify(body)}),{sender:'address:1',write:line=>lines.push(line),allowed});
 assert.equal((await post({event:'message_drawn',company,conversation,ms:50})).status,204);
 assert.equal((await post({event:'run_started',company,conversation,ms:50})).status,400);
 assert.equal((await post({event:'reply_drawn',company,conversation,ms:50})).status,429);
 assert.equal(lines.length,1);
 assert.equal(JSON.parse(lines[0]).event,'message_drawn');
});

test('a setting save writes one line of each step\'s whole milliseconds, with ids and the setting\'s name only',async()=>{
 const {settingSaveLine}=await import('../lib/diagnostics.mjs');
 const entry=JSON.parse(settingSaveLine({company:'0B7E3A52-1c4d-4f6a-9b8e-2d5c7f1a3e90',setting:'model',status:200,steps:{signIn:9.6,queue:11.2,owner:40,reads:310.4,engineWrite:NaN,value:3,done:812.5}},{now:new Date('2026-11-23T10:00:00Z')}));
 assert.deepEqual(entry,{event:'agent_setting_saved',at:'2026-11-23T10:00:00.000Z',company:'0b7e3a52-1c4d-4f6a-9b8e-2d5c7f1a3e90',setting:'model',status:200,ms:{signIn:10,queue:11,owner:40,reads:310,done:813}});
 // A setting name that is not one of ours, or any value, never reaches the line.
 assert.equal(JSON.parse(settingSaveLine({company:'nope',setting:'sk-ant-secret value',status:'x',steps:{}})).setting,null);
 assert.equal(JSON.parse(settingSaveLine({company:'nope',setting:'model',status:'x',steps:{}})).company,null);
});

test('a redirect from a server action is not logged as a failure',async()=>{
 const {withActionLog}=await import('../lib/diagnostics.mjs');
 const lines=[]; const redirect=Object.assign(new Error('NEXT_REDIRECT'),{digest:'NEXT_REDIRECT;replace;/c/x;307;'});
 await assert.rejects(withActionLog('workAction',async()=>{throw redirect;},{write:line=>lines.push(line)})(),redirect);
 assert.deepEqual(lines,[]);
});

test('the client error endpoint logs the message and stack of a page error without secrets, and refuses bad or excess reports',async()=>{
 const {clientErrorResponse,senderLimiter}=await import('../lib/diagnostics.mjs');
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
 let now=0; const allowed=senderLimiter({perSender:2,windowMs:1000,clock:()=>now});
 assert.deepEqual([allowed('a'),allowed('a'),allowed('a')],[true,true,false]); now=1500; assert.equal(allowed('a'),true);
});

test('every server action is wrapped so a thrown failure is logged',()=>{
 const files=readdirSync('app',{recursive:true}).map(file=>`app/${file}`).filter(file=>/\.tsx?$/.test(file)&&/^'use server'/.test(readFileSync(file,'utf8')));
 assert.ok(files.length>=5,files.join());
 for(const file of files) for(const line of readFileSync(file,'utf8').split('\n').filter(line=>/^export /.test(line))) assert.match(line,/^export const (\w+)=withActionLog\('\1',/,`${file}: ${line.slice(0,60)}`);
});
