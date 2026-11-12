import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

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

test('no message value names the Engine, in any language', () => {
 const named=catalogues.flatMap(file=>values(JSON.parse(readFileSync(`lib/messages/${file}`,'utf8')),file,[]))
  .filter(([,text])=>/hermes|هيرمس|هرمس/i.test(text)).map(([path])=>path);
 assert.deepEqual(named,[]);
});
