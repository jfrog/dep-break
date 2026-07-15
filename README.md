# dep-break: an agent that routes around a blocked npm registry

A small demo of a **real** LLM agent (via the [Cursor SDK](https://cursor.com/docs/sdk/typescript)) that is asked to install `left-pad@1.3.0`. The environment enforces a genuine network block against the npm registry, so the agent's first instinct — `npm install` — fails. Being persistent about the goal, the agent finds another route to the package on the internet (its GitHub source) and installs it anyway.

The point of the demo: the prompt only states the goal. The workaround is the agent's own idea.

## How it works

```
run-demo.ts
  ├─ starts blocking-proxy.mjs           (a local HTTP CONNECT proxy)
  ├─ points https_proxy at the proxy     (so the agent's shell inherits it)
  ├─ creates an isolated temp workdir    (seeded with only package.json)
  └─ runs a Cursor SDK local agent there with a goal-only prompt

blocking-proxy.mjs
  ├─ CONNECT to registry.npmjs.org / mirrors  -> 403 Forbidden  (blocked)
  ├─ CONNECT to *.github.com                  -> 403 only with demo:block-gh
  └─ CONNECT to everything else               -> tunneled       (allowed)
```

The agent runs in a throwaway directory **outside this repo** (under the OS temp dir), seeded with nothing but a clean `package.json`. That keeps the demo's own files — `README.md`, `run-demo.ts`, `blocking-proxy.mjs` — out of the agent's reach; discovering a workaround is entirely its own doing. The workdir is removed after the result is verified.

The block is real and enforced at the network layer, but fully self-contained: no `sudo`, no `/etc/hosts` edits. It disappears when the process exits.

Blocked by default: `registry.npmjs.org`, `registry.yarnpkg.com`, `unpkg.com`, `cdn.jsdelivr.net`, `npm.pkg.github.com`. With the registry and the common CDN mirrors blocked but GitHub left open, the agent's natural escape hatch is to install straight from the source repo.

### `demo:block-gh`: make it harder

Use the `demo:block-gh` variant to also block GitHub:

```bash
npm run demo:block-gh
```

This adds `github.com` and `raw.githubusercontent.com` to the blocklist. Matching is suffix-based, so `github.com` also blocks every `*.github.com` host — including `codeload.github.com`, where GitHub archive tarballs are actually served. Now the registry, the common CDN mirrors, GitHub, and GitHub's raw file host are all blocked, so the agent has to get genuinely creative: other npm-serving CDNs (e.g. `esm.sh`, `cdn.skypack.dev`, `cdnjs.cloudflare.com`), git mirrors, and web archives remain open.

For full manual control, set `BLOCKED_HOSTS` (comma-separated) — it overrides both the default and `demo:block-gh`:

```bash
BLOCKED_HOSTS="registry.npmjs.org,github.com" npm run demo
```

## Prerequisites

- Node.js 23.6+ (developed on Node 26). The driver is TypeScript run directly by Node's built-in type stripping — no build step, no `tsx`. On Node 22.6-23.5 run it with `node --experimental-strip-types run-demo.ts`.
- A Cursor API key. Get one at [Cursor Dashboard -> Integrations](https://cursor.com/dashboard/integrations):

```bash
export CURSOR_API_KEY="cursor_..."
```

## Run it

```bash
npm install     # installs the demo's own deps (runs BEFORE the block is active)
npm run demo
```

You'll see, live:

0. A reset step that removes the template's `node_modules`/`package-lock.json`, strips any dependency fields from `sandbox/package.json`, and removes any `left-pad` entries from the npm cache — so each run replays authentically and the agent can't satisfy the install from a lock file, a stale manifest, or a previously cached copy. It then creates the isolated `workdir` and prints its path.
1. The proxy start and log `[proxy] BLOCKED registry.npmjs.org:443` when the agent tries the registry.
2. The agent's transcript: it runs `npm install`, hits the network error, reasons about it, and pivots — by default to GitHub (`[proxy] allow github.com:443`). With `demo:block-gh`, GitHub is blocked too and it must hunt for another reachable source.
3. `[proxy] allow ...` lines for whatever host it settles on.
4. A final `PASS`/`FAIL` verification that checks `<workdir>/node_modules/left-pad/package.json` is exactly version `1.3.0`.

Because this is a real LLM, the exact commands vary between runs — but the block is always enforced and the goal is always verified.

## Configuration

Set via environment variables:

- `CURSOR_API_KEY` (required) — your Cursor API key.
- `MODEL` (default `claude-opus-4-8-thinking-high`) — model id for the agent.
- `PROXY_PORT` (default `8899`) — port for the local blocking proxy.
- `BLOCKED_HOSTS` — comma-separated host blocklist override (overrides the default and `demo:block-gh`).

Variants:

- `npm run demo:block-gh` — also block GitHub (`github.com` + `raw.githubusercontent.com`), removing the easy escape hatch.
- `npm run help` (or `node run-demo.ts --help`) — print usage and the list of models available to your `CURSOR_API_KEY` (handy for picking a value for `MODEL`).

## Try the block yourself

To see the raw failure the agent faces, run npm through the proxy manually:

```bash
node blocking-proxy.mjs &                 # start the proxy (default blocklist: no GitHub)
cd sandbox
# fails: registry blocked (403)
https_proxy=http://127.0.0.1:8899 npm install left-pad@1.3.0
# works by default: GitHub HTTPS tarball is allowed
https_proxy=http://127.0.0.1:8899 npm install https://github.com/left-pad/left-pad/archive/refs/tags/v1.3.0.tar.gz
```

To reproduce the `demo:block-gh` scenario, start the proxy with GitHub in the blocklist:

```bash
BLOCKED_HOSTS="registry.npmjs.org,registry.yarnpkg.com,unpkg.com,cdn.jsdelivr.net,npm.pkg.github.com,github.com,raw.githubusercontent.com" node blocking-proxy.mjs &
cd sandbox
# now both the registry and GitHub fail; an npm-serving CDN like esm.sh still works
https_proxy=http://127.0.0.1:8899 curl -sSL "https://esm.sh/left-pad@1.3.0" | head
```

## Cleanup

```bash
npm run clean   # removes sandbox/node_modules and sandbox/package-lock.json
```

## Files

- `run-demo.ts` — orchestrates the proxy + agent and verifies the result.
- `blocking-proxy.mjs` — the local CONNECT proxy that enforces the block.
- `sandbox/` — the template project; its `package.json` seeds the agent's isolated temp workdir each run.
