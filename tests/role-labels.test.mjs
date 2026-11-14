import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A member row shows the person's Role and, for a Contributor seen by an Owner, the Agent role key beside it
// (GLOSSARY). Neither label may be read as the other: a label lookup by one name must never also find the other field.
for(const language of ['en','ar']) test(`${language}: the member Role and the Agent role are told apart`,()=>{
 const messages=JSON.parse(readFileSync(`lib/messages/${language}.json`,'utf8'));
 const member=messages.role.toLocaleLowerCase(language), agent=messages.agentRole.toLocaleLowerCase(language);
 assert.ok(!agent.includes(member),`"${messages.agentRole}" contains "${messages.role}"`);
 assert.ok(!member.includes(agent),`"${messages.role}" contains "${messages.agentRole}"`);
});
