// The fake model provider every probe of spec #822 talks to. It is not part of the product and holds no key: it answers
// each chat completion, streamed or not, from what the Run's own words ask for, so a probe steers it without a second
// channel. A line of the newest user message may say:
//
//   DELAY <seconds>                 wait that long before answering (a slow model, to hold a Run open)
//   CALL <tool> <json arguments>    call that tool first; several CALL lines are called in order, one per turn
//   REPLY <text>                    answer with this text once every CALL is done (default: "fake reply")
//
// A request that offers no tools (the Engine's title or compaction call) gets a one-line summary.
//
// Every request is kept, and GET /requests on port 8080 gives the newest 50 (tool names offered, last message, every
// user message's text, and the system prompt's `## ` headings and its Bot Mode roster lines), so a probe can show which
// tools, which prompt sections and which history a Run was offered. GET /requests?contains=<text> counts the kept
// requests whose whole body (system prompt included) holds that text. A probe's requests are kept whole, up to 500.
import {createServer} from 'node:http';

const kept=[];
const bodies=[];
const text=content=>typeof content==='string'?content:Array.isArray(content)?content.map(part=>part?.text||'').join('\n'):'';
const plan=(messages,tools)=>{
 // A request that offers no tools is the Engine's own side call (a title, a compaction summary): it gets a short text and
 // never a tool call, even when the transcript it summarises holds CALL lines.
 if(!tools?.length) return {delay:0,call:null,reply:'Earlier turns, summarised.'};
 const at=messages.findLastIndex(message=>message.role==='user');
 const lines=text(messages[at]?.content).split('\n').map(line=>line.trim());
 const delay=Number(lines.find(line=>line.startsWith('DELAY '))?.slice(6))||0;
 const calls=lines.filter(line=>line.startsWith('CALL ')).map(line=>{
  const [, name, ...rest]=line.split(' ');
  return {name,arguments:rest.join(' ')||'{}'};
 });
 const reply=lines.find(line=>line.startsWith('REPLY '))?.slice(6)||'fake reply';
 // The calls already answered in this turn are the tool messages after the newest user message.
 const done=messages.slice(at+1).filter(message=>message.role==='tool').length;
 return {delay,call:calls[done]?{id:`call_${done}_${calls[done].name}`,type:'function',function:calls[done]}:null,reply};
};

const server=createServer((request,response)=>{
 if(request.method==='GET'&&request.url.startsWith('/requests?contains=')) {
  const needle=decodeURIComponent(request.url.slice('/requests?contains='.length));
  response.writeHead(200,{'Content-Type':'application/json'});
  return response.end(JSON.stringify({count:bodies.filter(body=>body.includes(needle)).length,of:bodies.length}));
 }
 if(request.method==='GET'&&request.url==='/requests') { response.writeHead(200,{'Content-Type':'application/json'}); return response.end(JSON.stringify(kept.slice(-50))); }
 if(request.method==='GET') { response.writeHead(200,{'Content-Type':'application/json'}); return response.end('{"ok":true}'); }
 let raw=''; request.on('data',chunk=>{ raw+=chunk; }); request.on('end',async()=>{
  if(!request.url.endsWith('/chat/completions')) { response.writeHead(404); return response.end(); }
  const body=JSON.parse(raw||'{}');
  const {delay,call,reply}=plan(body.messages||[],body.tools);
  const system=text((body.messages||[]).find(message=>message.role==='system')?.content).split('\n');
  bodies.push(raw);
  kept.push({at:Date.now(),tools:(body.tools||[]).map(tool=>tool.function?.name),last:body.messages?.at(-1),auth:request.headers.authorization||null,
   headings:system.filter(line=>line.startsWith('## ')),roster:system.filter(line=>line.startsWith('- `@')),
   users:(body.messages||[]).filter(message=>message.role==='user').map(message=>text(message.content))});
  if(kept.length>500) kept.splice(0,kept.length-500);
  if(bodies.length>500) bodies.splice(0,bodies.length-500);
  if(delay) await new Promise(resolve=>setTimeout(resolve,delay*1000));
  const finish=call?'tool_calls':'stop';
  // Usage near what a real provider counts (about four characters a token), so the Engine's context accounting and its
  // compaction see the Conversation's real size.
  const prompt=Math.ceil(raw.length/4);
  const usage={prompt_tokens:prompt,completion_tokens:8,total_tokens:prompt+8};
  const message=call?{role:'assistant',content:null,tool_calls:[call]}:{role:'assistant',content:reply};
  if(!body.stream) { response.writeHead(200,{'Content-Type':'application/json'}); return response.end(JSON.stringify({id:'fake',object:'chat.completion',created:0,model:body.model,choices:[{index:0,message,finish_reason:finish}],usage})); }
  response.writeHead(200,{'Content-Type':'text/event-stream'});
  const chunk=(choices,extra={})=>response.write(`data: ${JSON.stringify({id:'fake',object:'chat.completion.chunk',created:0,model:body.model,choices,...extra})}\n\n`);
  chunk([{index:0,delta:call?{role:'assistant',tool_calls:[{index:0,...call}]}:message,finish_reason:null}]);
  chunk([{index:0,delta:{},finish_reason:finish}]);
  chunk([],{usage});
  response.end('data: [DONE]\n\n');
 });
});
server.listen(8080,'0.0.0.0');
