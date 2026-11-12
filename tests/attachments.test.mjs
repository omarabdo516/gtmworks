import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentHeaders, filesProblem, isThumbnail, maxBytes, maxFiles } from '../lib/attachments.mjs';

test('a raster image is shown in the page; any other type is downloaded as opaque bytes', () => {
 for(const type of ['image/png','image/jpeg','image/gif','image/webp']) {
  assert.equal(isThumbnail(type),true,type);
  assert.equal(attachmentHeaders({name:'a.png',content_type:type})['Content-Type'],type);
  assert.match(attachmentHeaders({name:'a.png',content_type:type})['Content-Disposition'],/^inline;/);
 }
 // An uploaded page or vector image could run script on our own origin, so it is never shown in place or typed as what it claims.
 for(const type of ['text/html','image/svg+xml','application/pdf','application/javascript','']) {
  assert.equal(isThumbnail(type),false,type);
  const headers=attachmentHeaders({name:'a.bin',content_type:type});
  assert.equal(headers['Content-Type'],'application/octet-stream',type);
  assert.match(headers['Content-Disposition'],/^attachment;/,type);
 }
});

test('every download is sandboxed, never sniffed and never cached', () => {
 const headers=attachmentHeaders({name:'a.png',content_type:'image/png'});
 assert.equal(headers['X-Content-Type-Options'],'nosniff');
 assert.match(headers['Content-Security-Policy'],/sandbox/);
 assert.equal(headers['Cache-Control'],'private, no-store');
});

test('the file name travels percent-encoded, so Arabic and quotes cannot break the header', () => {
 const header=attachmentHeaders({name:'تصميم "الإعلان" (1).png',content_type:'image/png'})['Content-Disposition'];
 assert.equal(header,"inline; filename*=UTF-8''%D8%AA%D8%B5%D9%85%D9%8A%D9%85%20%22%D8%A7%D9%84%D8%A5%D8%B9%D9%84%D8%A7%D9%86%22%20%281%29.png");
});

test('a message carries at most five files of at most 20 MiB, none empty', () => {
 assert.equal(maxFiles,5); assert.equal(maxBytes,20*1024*1024);
 assert.equal(filesProblem([]),null);
 assert.equal(filesProblem(Array.from({length:5},()=>({size:1}))),null);
 assert.equal(filesProblem([{size:maxBytes}]),null);
 assert.equal(filesProblem(Array.from({length:6},()=>({size:1}))),'count');
 assert.equal(filesProblem([{size:maxBytes+1}]),'size');
 assert.equal(filesProblem([{size:0}]),'size');
});
