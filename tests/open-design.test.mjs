import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { openDesignApp, designProfileOf, openDesignServer, openDesignKeyOf, newDesignKey, designProfileConfig, engineSocket } from '../lib/open-design.mjs';
import { sandboxRoute } from '../lib/sandbox-command.mjs';
import { agentPaths } from '../sandbox/open-design/daemon.mjs';
import { noAgentGets } from '../lib/agent-toolsets.mjs';

// The Open Design app (#544, ADR 0025): the Engine runs Open Design's MCP command in the work sandbox over the terminal
// backend's ssh route, and that same session forwards one socket back to the Engine's Run API, which is how Open Design's
// design runtime reaches the Agent's design profile with no model credential in the sandbox.
const profile='ag-0123456789abcdef0123456789abcdef';
const key='k'.repeat(43);

test('the Agent\'s design profile is a profile of its own, named for the Agent', () => {
 assert.equal(designProfileOf(profile),`od-${profile}`);
 assert.equal(designProfileOf('co-0123456789abcdef0123456789abcdef'),'od-co-0123456789abcdef0123456789abcdef');
 for(const wrong of ['', 'od-x', 'ag-../x', 'AG-1', null, 'cs-0123456789abcdef0123456789abcdef']) assert.equal(designProfileOf(wrong),null,String(wrong));
 assert.equal(openDesignApp,'open-design');
});

test('the Engine gets ssh into the sandbox on the terminal backend\'s route, with the Run API forwarded to one socket of the Agent\'s', () => {
 const server=openDesignServer({profile,engine:'gtmworks-engine-first',key});
 assert.equal(server?.command,'ssh');
 const args=server.args;
 const forward=args.indexOf('-R');
 assert.ok(forward>0);
 assert.equal(args[forward+1],`/home/pn/.gtmworks/engine-${profile}.sock:gtmworks-engine-first:8642`);
 assert.ok(args.join(' ').includes('-o ExitOnForwardFailure=yes'));
 // Every option of the terminal backend's own route is there, and ssh's options still end before the host.
 const withoutForward=[...args.slice(0,forward-2),...args.slice(forward+2,-1)];
 assert.deepEqual(withoutForward,[...sandboxRoute]);
 assert.equal(args.at(-1),`builtin cd -- /work/${profile} || exit 126; exec 'open-design-mcp' 'od-${profile}' '${key}'`);
});

test('the socket the Engine forwards is the one the sandbox\'s daemon adopts for the Agent', () => {
 assert.equal(engineSocket(profile),agentPaths(`/work/${profile}`,'/home/pn').socket);
});

test('only a design key and an Engine name that are one word reach the entry', () => {
 assert.equal(openDesignServer({profile,engine:'engine first',key}),null);
 assert.equal(openDesignServer({profile,engine:'-oProxyCommand=x',key}),null);
 assert.equal(openDesignServer({profile,engine:'gtmworks-engine-first',key:"x'; rm -rf /"}),null);
 assert.equal(openDesignServer({profile:'ag-..',engine:'gtmworks-engine-first',key}),null);
 const made=newDesignKey();
 assert.match(made,/^[A-Za-z0-9_-]{43}$/);
 assert.notEqual(made,newDesignKey());
});

test('the key reads back only from an entry gtmworks wrote for that Agent', () => {
 const server=openDesignServer({profile,engine:'gtmworks-engine-first',key});
 assert.equal(openDesignKeyOf(server,profile),key);
 assert.equal(openDesignKeyOf(server,'ag-ffffffffffffffffffffffffffffffff'),null);
 assert.equal(openDesignKeyOf({...server,command:'sh'},profile),null);
 assert.equal(openDesignKeyOf({command:'ssh',args:[...server.args.slice(0,-1),`${server.args.at(-1)}; id`]},profile),null);
 assert.equal(openDesignKeyOf({url:'https://example.com/mcp'},profile),null);
 assert.equal(openDesignKeyOf(null,profile),null);
});

test('the remote command is the design profile and its key as two words of the sandbox\'s shell', () => {
 const server=openDesignServer({profile,engine:'gtmworks-engine-first',key});
 const remote=server.args.at(-1).replace(/^builtin cd -- \S+ \|\| exit 126; exec 'open-design-mcp'/,"printf '%s\\n'");
 assert.equal(execFileSync('bash',['-c',remote],{encoding:'utf8'}),`od-${profile}\n${key}\n`);
});

test('the design profile works in the Agent\'s own folder with the work tools and none that stay off', () => {
 const config=designProfileConfig(profile);
 assert.equal(config.terminal.cwd,`/work/${profile}`);
 assert.ok(config.platform_toolsets.api_server.includes('file'));
 assert.ok(config.platform_toolsets.api_server.includes('terminal'));
 assert.ok(noAgentGets.every(name=>!config.platform_toolsets.api_server.includes(name)));
 assert.ok(config.agent.disabled_toolsets.includes('delegation'));
 assert.ok(!config.platform_toolsets.api_server.includes('clarify')&&config.agent.disabled_toolsets.includes('clarify'),'no question nobody would read');
});
