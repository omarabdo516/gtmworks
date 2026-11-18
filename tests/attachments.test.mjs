import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentHeaders, conversationFilesProblem, filesProblem, isThumbnail, maxBytes, maxFiles, maxRequestBytes } from '../lib/attachments.mjs';

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

// #155: what a Conversation's message may carry is narrower than a Card's, because the Engine reads images only and one
// request is at most 10 MB. Each way it is refused is checked here, and the server and the composer ask the same
// function, so the line a person reads and the refusal the route answers are one rule.
const image=(size=1024,type='image/png')=>({name:'a.png',content_type:type,size});
test('a message carries only the image kinds the Agent reads, at most five, of at most 20 MiB each', () => {
 assert.equal(maxRequestBytes,10_000_000);
 assert.equal(conversationFilesProblem([]),null);
 assert.equal(conversationFilesProblem([image()]),null);
 assert.equal(conversationFilesProblem(Array.from({length:maxFiles},()=>image())),null);
 for(const type of ['application/pdf','text/plain','image/svg+xml','']) assert.equal(conversationFilesProblem([image(1024,type)]),'type',type);
 assert.equal(conversationFilesProblem(Array.from({length:maxFiles+1},()=>image())),'count','more files than maxFiles');
 assert.equal(conversationFilesProblem([image(0)]),'size','an empty file');
 assert.equal(conversationFilesProblem([image(maxBytes+1)]),'size','a file past the per-file size');
});

test('the message is refused when its text and base64 images would pass the Engine request limit', () => {
 // Base64 is four bytes for every three, so this many bytes of image comes to just under the limit alone.
 const almost=maxRequestBytes/4*3;
 assert.equal(conversationFilesProblem([image(almost-200,'image/png')],''),null,'one image just under the limit is sent');
 assert.equal(conversationFilesProblem([image(almost,'image/png')],''),'request','the base64 of the image passes it');
 assert.equal(conversationFilesProblem([image(almost-200,'image/png')],'x'.repeat(400)),'request','the text counts beside the images');
 assert.equal(conversationFilesProblem([image(almost/2,'image/png'),image(almost/2,'image/png')],''),'request','many images count together');
 assert.equal(conversationFilesProblem([],'x'.repeat(maxRequestBytes+1)),'request','the text alone can pass it');
});
