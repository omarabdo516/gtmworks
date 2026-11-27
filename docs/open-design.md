# Connect Open Design

[Open Design](https://github.com/nexu-io/open-design) makes designs. gtmworks does not ship it (ADR 0035): you put it in
your Company's work folder, start its daemon there, and connect it from the apps sheet. Its card is the "A command in
the work sandbox" card, already filled in. Every command below was run against **Open Design 0.27.2** (tag
`open-design-v0.27.2`) on Node 26 as an ordinary user, with `/work` and the home folder writable, and no git and no
compiler, as in the work sandbox.

## 1. Open a shell in the Company's work sandbox

On the server, as the user who runs gtmworks, find the Company's sandbox and open a shell in it as its work user:

```sh
docker ps --filter name=gtmworks-sandbox- --format '{{.Names}}'
docker exec -it --user pn gtmworks-sandbox-<name> sh
```

Every command after this runs in that shell.

## 2. Put Open Design in the work folder

The sandbox has no git, so fetch the release with Node, then install and build it (about a minute, and 2.5 GB of the
Company's work disk; `gtmworks company limits <Company> --disk 20g` on the server raises it if it is short):

```sh
cd /work
node -e 'fetch(process.argv[1]).then(r=>{if(!r.ok)throw new Error(r.status);return r.arrayBuffer()}).then(b=>require("fs").writeFileSync("/tmp/open-design.tar.gz",Buffer.from(b)))' https://github.com/nexu-io/open-design/archive/refs/tags/open-design-v0.27.2.tar.gz
mkdir open-design && tar -xzf /tmp/open-design.tar.gz -C open-design --strip-components=1 && rm /tmp/open-design.tar.gz
cd /work/open-design
CI=true npx --yes pnpm@10.33.2 install --frozen-lockfile
test -f apps/daemon/dist/cli.js && echo ready
```

## 3. Give it a model

Open Design draws with an agent program it finds on its daemon's `PATH` (Claude Code, Codex, OpenCode and others), set
up inside Open Design; gtmworks gives it no key. Install the one you use in the work folder and sign it in there as its
own documentation says. For example OpenCode, which Open Design also uses for its own-key (BYOK) runs:

```sh
npm install --prefix /work/open-design-tools --no-fund --no-audit opencode-ai
```

Whatever key or sign-in it keeps is in the Company's work sandbox, where anyone who talks to an Agent with Open Design
on can reach it (ADR 0024).

## 4. Start its daemon

On the sandbox's own loopback, with its designs kept in the work folder, so they are in the Library:

```sh
cd /work/open-design
PATH="/work/open-design-tools/node_modules/.bin:$PATH" OD_DATA_DIR=/work/open-design-data \
  nohup node apps/daemon/dist/cli.js --no-open --host 127.0.0.1 --port 7456 > "$HOME/open-design.log" 2>&1 &
```

Check it answers, and which agent programs it found (for the example above, `opencode,byok-opencode`):

```sh
node -e 'fetch("http://127.0.0.1:7456/api/health").then(r=>r.json()).then(j=>console.log(j.ok))'
node -e 'fetch("http://127.0.0.1:7456/api/agents").then(r=>r.json()).then(j=>console.log(j.agents.filter(a=>a.available).map(a=>a.id).join(",")))'
```

The daemon stops when the sandbox restarts (an update, a server restart): run this step again then.

## 5. Connect it

In gtmworks, open Apps, pick **Open Design**. The card is filled in:

| Field | Value |
| --- | --- |
| Name | `open-design` |
| How it connects | A command in the work sandbox |
| Command | `node` |
| Arguments | `/work/open-design/apps/daemon/dist/cli.js`, `mcp`, `--daemon-url`, `http://127.0.0.1:7456`, one per line |

Pick the Agents who get it and press **Test**: it lists Open Design's tools (`create_project`, `start_run`, `get_run`,
`list_files` and the rest, 22 in 0.27.2). Press **Add**. Turn it on or off for each Agent like any app. If Test lists
nothing, the daemon is not running (step 4) or the path in the first argument is not where you put Open Design.

## Open Design somewhere else

If Open Design runs elsewhere (its own Docker deployment, another machine), change the last argument to its address. The
work sandbox must reach that address: `127.0.0.1` is the sandbox's own loopback, never the server's, so a daemon
published on the server's loopback is out of its reach. `od mcp` in 0.27.2 sends no `OD_API_TOKEN`, so a daemon that
requires one refuses it. The first argument still needs Open Design's CLI in the work folder (step 2).
