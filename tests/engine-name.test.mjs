import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { engineName } from './ui-words.mjs';

// A person never reads the Engine's name (#286). Message keys may keep it; no value may.
const catalogues=readdirSync('lib/messages').filter(file=>file.endsWith('.json')).sort();
function values(node,path,found) {
 if(typeof node==='string') found.push([path,node]);
 else if(node&&typeof node==='object') for(const [key,value] of Object.entries(node)) values(value,`${path}.${key}`,found);
 return found;
}

test('every message catalogue is checked, English and Arabic included', () => {
 for(const file of ['en.json','ar.json']) assert.ok(catalogues.includes(file),file);
 for(const file of catalogues) assert.ok(values(JSON.parse(readFileSync(`lib/messages/${file}`,'utf8')),file,[]).length>0,file);
});

// The one exception: the Owner's Settings row that opens the Engine's own dashboard is called "Hermes" (spec #866, #869,
// ADR 0033 item 4), as the dashboard it opens calls itself.
const namesTheDashboard=new Set(['en.json.settingsHermes','ar.json.settingsHermes']);
test('no message value names the Engine, in any language', () => {
 const named=catalogues.flatMap(file=>values(JSON.parse(readFileSync(`lib/messages/${file}`,'utf8')),file,[]))
  .filter(([path,text])=>engineName.test(text)&&!namesTheDashboard.has(path)).map(([path])=>path);
 assert.deepEqual(named,[]);
});
