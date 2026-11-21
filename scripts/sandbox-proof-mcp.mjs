// A small stdio MCP server the install proof places in the Company's work sandbox (#459): the Owner's own command server,
// with no dependency, speaking newline-delimited JSON-RPC as the MCP stdio transport does. Its one tool, `prove`, says
// where it runs (the host name and its start folder) and writes that into its start folder, which is the Agent's own
// folder in the Company's work folder. A call holds until the proof creates `<marker>.release` beside it, so the install
// job can list the processes of the Engine and of the sandbox while the call is running.
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const send=message=>process.stdout.write(`${JSON.stringify({jsonrpc:'2.0',...message})}\n`);
const tools=[{name:'prove',description:'Say where this server runs, and write it into its start folder.',
 inputSchema:{type:'object',properties:{marker:{type:'string'}},required:['marker']}}];

async function call(id,params) {
 const marker=String(params?.arguments?.marker??'');
 if(!/^[a-z0-9-]{8,64}$/.test(marker)) return send({id,result:{content:[{type:'text',text:'a marker of letters, digits and hyphens'}],isError:true}});
 const where=`${hostname()} ${process.cwd()} ${process.pid}`;
 writeFileSync(`${marker}-calling.txt`,`${where}\n`);
 for(let waited=0;waited<120&&!existsSync(`${marker}.release`);waited++) await sleep(500);
 writeFileSync(`${marker}-mcp.txt`,`${where}\n`);
 send({id,result:{content:[{type:'text',text:where}],isError:false}});
}

createInterface({input:process.stdin}).on('line',line=>{
 let message; try { message=JSON.parse(line); } catch { return; }
 const {id,method,params}=message;
 if(id===undefined) return;
 if(method==='initialize') return send({id,result:{protocolVersion:params?.protocolVersion??'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'sandbox-proof',version:'1.0.0'}}});
 if(method==='tools/list') return send({id,result:{tools}});
 if(method==='tools/call') return void call(id,params);
 if(method==='ping') return send({id,result:{}});
 send({id,error:{code:-32601,message:'Method not found'}});
});
