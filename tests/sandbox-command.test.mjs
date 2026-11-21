import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { sandboxServer, sandboxCommandOf, sandboxCommandOk, sandboxRoute } from '../lib/sandbox-command.mjs';
import { readFileSync } from 'node:fs';

// A command MCP server (#459, ADR 0024) is handed to the Engine as ssh into the Company's work sandbox, never as the
// Owner's own command: the prefix is gtmworks's, the Owner's words are quoted after the host, and they read back exactly.
const profile='ag-0123456789abcdef0123456789abcdef';

test('the Engine is handed ssh into the sandbox, and the Owner\'s command runs from the Agent\'s own folder', () => {
 const server=sandboxServer({profile,command:'od',args:['mcp','--daemon-url','http://127.0.0.1:7456']});
 assert.equal(server?.command,'ssh');
 assert.deepEqual(server.args.slice(0,-1),[...sandboxRoute]);
 assert.equal(server.args.at(-1),`builtin cd -- /work/${profile} || exit 126; exec 'od' 'mcp' '--daemon-url' 'http://127.0.0.1:7456'`);
 assert.deepEqual(sandboxCommandOf(server),{command:'od',args:['mcp','--daemon-url','http://127.0.0.1:7456']});
});

test('the route is the terminal backend\'s own: its key, its user, its port and its pinned host key', () => {
 const route=sandboxRoute.join(' ');
 const managed=readFileSync(new URL('../scripts/engine-managed.yml',import.meta.url),'utf8');
 const pinned=name=>managed.match(new RegExp(`^  ${name}: (\\S+)$`,'m'))?.[1];
 assert.ok(route.includes(`-i ${pinned('ssh_key')}`),'the key the terminal backend uses');
 assert.ok(route.includes(`-p ${pinned('ssh_port')} -- ${pinned('ssh_user')}@${pinned('ssh_host')}`),'its port, user and host');
 assert.match(route,/StrictHostKeyChecking=yes/);
 assert.match(route,/UserKnownHostsFile=\/opt\/data\/\.ssh\/known_hosts/);
 assert.match(route,/BatchMode=yes/);
 assert.deepEqual(sandboxRoute.slice(-2),['--','pn@sandbox'],'ssh\'s options end before the host, and the Owner\'s words are the one argument after it');
});

test('any word the Owner types is one word in the sandbox\'s shell, and reads back as typed', () => {
 const args=["it's",'$(id)','`id`','a b','; rm -rf /','"q"','','--x=1','\\n'];
 const server=sandboxServer({profile,command:'/work/tools/server.sh',args});
 assert.deepEqual(sandboxCommandOf(server),{command:'/work/tools/server.sh',args});
 // The sandbox's login shell is bash -c with the remote command: printf shows each word arrives alone and unexpanded.
 const remote=server.args.at(-1).replace(/^builtin cd -- \S+ \|\| exit 126; exec '\/work\/tools\/server\.sh'/,"printf '%s\\n'");
 const printed=execFileSync('bash',['-c',remote],{encoding:'utf8'});
 assert.equal(printed,args.map(word=>`${word}\n`).join(''));
});

test('a command that is not one program, a control character or too much is refused', () => {
 for(const command of ['', 'od mcp', 'od\n', 'a'.repeat(501), 7, null]) assert.equal(sandboxServer({profile,command,args:[]}),null,String(command));
 assert.equal(sandboxServer({profile,command:'od',args:['ok\nnext']}),null);
 assert.equal(sandboxServer({profile,command:'od',args:Array(51).fill('x')}),null);
 assert.equal(sandboxServer({profile,command:'od',args:'mcp'}),null);
 assert.equal(sandboxServer({profile:'../etc',command:'od',args:[]}),null);
 assert.equal(sandboxCommandOk('od',['mcp']),true);
});

test('only an entry gtmworks wrote reads back as a sandbox command', () => {
 const server=sandboxServer({profile,command:'od',args:['mcp']});
 assert.equal(sandboxCommandOf({url:'https://mcp.example/mcp'}),null);
 assert.equal(sandboxCommandOf({command:'npx',args:['-y','server']}),null,'a command in the Engine\'s own container is not one');
 assert.equal(sandboxCommandOf({...server,args:server.args.map(word=>word==='pn@sandbox'?'root@elsewhere':word)}),null);
 assert.equal(sandboxCommandOf({...server,args:[...server.args.slice(0,-1),'od mcp']}),null);
 assert.equal(sandboxCommandOf(null),null);
});
