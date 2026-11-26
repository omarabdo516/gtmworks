// Scriptable fake OpenAI model: each request is logged; plan.mjs (re-imported per request) decides the reply.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
let n=0;
createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',async()=>{
 if(req.method!=='POST'||!req.url.endsWith('/chat/completions')){res.writeHead(404);return res.end();}
 const body=JSON.parse(raw||'{}'); n++;
 appendFileSync('requests.log',JSON.stringify({n,tools:(body.tools||[]).map(t=>t.function?.name),messages:body.messages})+'\n');
 let call=null,reply='ok';
 try{const {plan}=await import(pathToFileURL('./plan.mjs').href+'?'+Date.now()); const r=plan(body.messages||[],body)||{}; call=r.call||null; reply=r.reply||'ok';}catch(e){appendFileSync('requests.log','PLANERR '+e.stack+'\n');}
 const finish=call?'tool_calls':'stop'; const usage={prompt_tokens:20,completion_tokens:8,total_tokens:28};
 if(!body.stream){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({id:'f',object:'chat.completion',created:0,model:body.model,choices:[{index:0,message:call?{role:'assistant',content:null,tool_calls:[call]}:{role:'assistant',content:reply},finish_reason:finish}],usage}));}
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const chunk=(choices,extra={})=>res.write(`data: ${JSON.stringify({id:'f',object:'chat.completion.chunk',created:0,model:body.model,choices,...extra})}\n\n`);
 chunk([{index:0,delta:call?{role:'assistant',tool_calls:[{index:0,...call}]}:{role:'assistant',content:reply},finish_reason:null}]);
 chunk([{index:0,delta:{},finish_reason:finish}]); chunk([],{usage}); res.end('data: [DONE]\n\n');
});}).listen(18080,'0.0.0.0');
