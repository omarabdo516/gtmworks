import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHermesAddressAllowed, testHermes } from '../lib/hermes.mjs';

for(const address of ['http://localhost:9119','http://127.0.0.1:9119','http://192.168.1.10','http://100.89.96.47:9119','http://hermes.tail1234.ts.net']) {
 test(`allows ${address}`,()=>assert.equal(isHermesAddressAllowed(address),true));
}
for(const address of ['http://example.com','http://8.8.8.8']) {
 test(`refuses ${address}`,()=>assert.equal(isHermesAddressAllowed(address),false));
}

test('HTTP exceptions stay within loopback, private and tailnet boundaries',()=>{
 for(const address of ['http://127.255.255.254','http://[::1]:9119','http://[0:0:0:0:0:0:0:1]','http://10.0.0.1','http://172.16.0.1','http://172.31.255.255','http://192.168.255.255','http://100.64.0.0','http://100.127.255.255','http://hermes','http://hermes.local','http://hermes.internal','http://HERMES.TAIL1234.TS.NET']) {
  assert.equal(isHermesAddressAllowed(address),true,address);
 }
 for(const address of ['http://172.15.255.255','http://172.32.0.0','http://192.169.0.1','http://100.63.255.255','http://100.128.0.0','http://[2606:4700:4700::1111]','http://hermes.ts.net.example.com','http://hermes.local.example.com','http://hermes.internal.example.com','http://notlocal.example','http://134744072']) {
  assert.equal(isHermesAddressAllowed(address),false,address);
 }
});

test('public Hermes addresses require HTTPS and invalid addresses are refused',()=>{
 for(const address of ['https://example.com','https://8.8.8.8','https://[2606:4700:4700::1111]']) assert.equal(isHermesAddressAllowed(address),true,address);
 for(const address of ['ftp://hermes','not a URL','']) assert.equal(isHermesAddressAllowed(address),false,address);
});

test('the Hermes client refuses public HTTP before any request can send a key',async context=>{
 const fetch=context.mock.method(globalThis,'fetch',()=>{throw new Error('Unexpected request');});
 await assert.rejects(testHermes({address:'http://example.com',profile:'writer',key:'test-only-key'}),/hermesHttpsRequired/);
 assert.equal(fetch.mock.callCount(),0);
});
