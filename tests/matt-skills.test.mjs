import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// #473: Matt Pocock's engineering skills are copied into .claude/skills/, the one place both local and cloud Claude Code
// sessions read from the clone; a plugin named in .claude/settings.json loads in local sessions only.
// scripts/vendor-matt-skills.sh holds the pinned upstream commit and the list of skills, and refreshes the copy.
const root=process.cwd();
const read=path=>readFileSync(join(root,path),'utf8');
const script=read('scripts/vendor-matt-skills.sh');
const pin=script.match(/^pin=([0-9a-f]{40})$/m)?.[1];
const listed=[...script.matchAll(/^  (?:engineering|productivity)\/([a-z-]+)$/gm)].map(match=>match[1]);
const frontmatterName=path=>readFileSync(path,'utf8').match(/^---\n(?:.*\n)*?name: ([^\n]+)\n(?:.*\n)*?---\n/)?.[1];

test('the script pins one upstream commit and lists the skills it vendors',()=>{
 assert.ok(pin,'pin=<40-character commit> in scripts/vendor-matt-skills.sh');
 assert.ok(listed.length>=20,`${listed.length} skills listed`);
 assert.equal(new Set(listed).size,listed.length,'no skill listed twice');
 // teach is left out (it turns the working folder into a teaching workspace); setup stays, since the other skills send a
 // session that lacks docs/agents/ to it.
 assert.ok(!listed.includes('teach'));
 assert.ok(listed.includes('setup-matt-pocock-skills'));
});

test('every listed skill is in .claude/skills/ under its own name, and nothing else is',()=>{
 for(const name of listed) {
  const file=join(root,'.claude/skills',name,'SKILL.md');
  assert.ok(existsSync(file),file);
  assert.equal(frontmatterName(file),name,file);
 }
 const folders=readdirSync(join(root,'.claude/skills'),{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name);
 assert.deepEqual(folders.sort(),[...listed].sort());
});

test('the plugin entries are gone from the repo settings, so a local session does not load every skill twice',()=>{
 const settings=JSON.parse(read('.claude/settings.json'));
 assert.equal(settings.enabledPlugins,undefined);
 assert.equal(settings.extraKnownMarketplaces,undefined);
});

test('the licence notice names the pinned commit and keeps the MIT text; the refresh steps are written down',()=>{
 const notices=read('THIRD_PARTY_NOTICES.md');
 const section=notices.slice(notices.indexOf('## Matt Pocock skills'));
 assert.ok(notices.includes('## Matt Pocock skills'));
 assert.ok(section.includes(pin),'THIRD_PARTY_NOTICES.md names the pinned commit');
 assert.match(section,/Copyright \(c\) 2026 Matt Pocock/);
 assert.match(section,/Permission is hereby granted, free of charge/);
 assert.match(read('docs/agents/matt-pocock-skills.md'),/scripts\/vendor-matt-skills\.sh/);
 assert.match(read('CLAUDE.md'),/docs\/agents\/matt-pocock-skills\.md/);
});

// A stand-in upstream: a git repo with two listed skills, one unlisted, and an old copy in the target to be replaced.
test('the script copies each listed skill from the given commit, replaces the old copy and leaves other folders alone',()=>{
 const dir=mkdtempSync(join(tmpdir(),'matt-skills-'));
 try {
  const upstream=join(dir,'upstream');
  const write=(path,text)=>{ mkdirSync(join(path,'..'),{recursive:true}); writeFileSync(path,text); };
  write(join(upstream,'skills/engineering/tdd/SKILL.md'),'---\nname: tdd\n---\nnew tdd\n');
  write(join(upstream,'skills/engineering/tdd/tests.md'),'tests\n');
  write(join(upstream,'skills/productivity/grilling/SKILL.md'),'---\nname: grilling\n---\n');
  write(join(upstream,'skills/engineering/setup-matt-pocock-skills/SKILL.md'),'---\nname: setup-matt-pocock-skills\n---\n');
  const git=(...args)=>execFileSync('git',['-C',upstream,...args],{encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'t',GIT_AUTHOR_EMAIL:'t@t',GIT_COMMITTER_NAME:'t',GIT_COMMITTER_EMAIL:'t@t'}}).trim();
  git('init','-q'); git('add','.'); git('commit','-qm','one');
  const commit=git('rev-parse','HEAD');
  const target=join(dir,'skills');
  write(join(target,'tdd/stale.md'),'old\n');
  write(join(target,'own-skill/SKILL.md'),'---\nname: own-skill\n---\n');
  const run=env=>spawnSync('bash',[join(root,'scripts/vendor-matt-skills.sh'),commit],{encoding:'utf8',
   env:{...process.env,MATT_SKILLS_SOURCE:upstream,MATT_SKILLS_TARGET:target,MATT_SKILLS_LIST:'engineering/tdd productivity/grilling',...env}});
  const result=run({});
  assert.equal(result.status,0,result.stderr);
  assert.equal(readFileSync(join(target,'tdd/SKILL.md'),'utf8'),'---\nname: tdd\n---\nnew tdd\n');
  assert.ok(existsSync(join(target,'tdd/tests.md')));
  assert.ok(!existsSync(join(target,'tdd/stale.md')),'the old copy is replaced, not merged');
  assert.ok(existsSync(join(target,'grilling/SKILL.md')));
  assert.ok(!existsSync(join(target,'setup-matt-pocock-skills')),'an unlisted skill is not copied');
  assert.ok(existsSync(join(target,'own-skill/SKILL.md')),"the repo's own skills are left alone");
  // A listed skill missing upstream stops the refresh before anything changes.
  const missing=run({MATT_SKILLS_LIST:'engineering/tdd engineering/gone'});
  assert.notEqual(missing.status,0);
  assert.match(missing.stderr,/engineering\/gone/);
  assert.ok(existsSync(join(target,'tdd/SKILL.md')));
 } finally { rmSync(dir,{recursive:true,force:true,maxRetries:5}); }
});
