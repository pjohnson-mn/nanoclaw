---
name: add-mcp-server
description: Add a custom MCP server to Nanoclaw containers so agents can use its tools. Supports stdio (command-based) and SSE/HTTP (URL-based) transports. Handles env var passthrough, per-group scoping, and container image updates.
---

# Add MCP Server

This skill registers a custom MCP server in the container agent runner so that Claude agents running inside Nanoclaw containers can use its tools.

## Architecture Context

Understanding the data flow is critical for getting this right:

- **Host orchestrator** (`src/container-runner.ts`) spawns Docker containers with specific `-e` flags and volume mounts
- **Container entrypoint** compiles `/app/src/*.ts` → `/tmp/dist/`, then runs `/tmp/dist/index.js`
- **Agent runner** (`container/agent-runner/src/index.ts`) calls the Claude SDK with `mcpServers` and `allowedTools`
- **`.env` is NOT available inside containers.** Nanoclaw's `readEnvFile()` reads `.env` on the host side only and deliberately does NOT inject into `process.env`. The `.env` file is also shadow-mounted to `/dev/null` for main group containers. For env vars to reach an MCP server inside a container, they must be explicitly passed via Docker `-e` flags in `buildContainerArgs()`.
- **Per-group agent-runner source** lives at `data/sessions/<group>/agent-runner-src/` and is mounted at `/app/src` (read-write). This is copied from `container/agent-runner/src/` only once when the group is first created. Changes to the canonical source do NOT auto-propagate to existing groups.
- **Container image** (`nanoclaw-agent:latest`) includes Node 22, npx, Chromium, curl, and git. `npx -y <package>` works without image rebuild. New system binaries or npm deps in `package.json` require rebuilding.

Two transport types are supported:
- **stdio** — A command run as a subprocess inside the container (e.g., `npx -y @modelcontextprotocol/server-filesystem`)
- **SSE / HTTP** — A URL-based server running on the host or network (e.g., `http://host.docker.internal:3000/sse`)

## Phase 1: Gather Requirements

Ask the user the following questions. Collect all answers before proceeding.

1. **Server name** — What should this MCP server be called? (Used internally as the key, e.g., `obsidian`, `github`, `my-calendar`. Lowercase letters, hyphens only.)

2. **Transport type** — Is this:
   - A **stdio** server (a command that runs as a process inside the container)?
   - An **SSE** server (an `http://` or `https://` URL)?

3. **For stdio servers**:
   - What is the command and arguments? (e.g., `npx -y @modelcontextprotocol/server-filesystem /workspace/group`)
   - Are any environment variables required? (e.g., API keys, tokens)
   - Is this a published npm package (can use `npx -y`) or a custom TypeScript file?

4. **For SSE servers**:
   - What is the URL? (Use `http://host.docker.internal:<port>/...` to reach services on the host machine from inside Docker)
   - Are any HTTP headers required? (e.g., `Authorization: Bearer <token>`)

5. **Scope** — Should this MCP server be available to:
   - **All groups** (global — modifies `container/agent-runner/src/index.ts`)
   - **One specific group only** (modifies only that group's `data/sessions/<group>/agent-runner-src/index.ts`)

## Phase 2: Pre-flight Checks

### Check if already added

Read `container/agent-runner/src/index.ts` and search for the server name in both `mcpServers` and `allowedTools`. If present, tell the user and stop.

### For stdio servers: verify binary availability in the container

```bash
docker run --rm nanoclaw-agent:latest which <binary>
# e.g.: docker run --rm nanoclaw-agent:latest which node
# e.g.: docker run --rm nanoclaw-agent:latest npx --version
```

If using `npx -y <package>`, verify the package exists:

```bash
docker run --rm nanoclaw-agent:latest npx -y <package-name> --help
```

If the binary is **not available**, explain the issue clearly:

> The command `<binary>` is not available in the container image. You have two options:
>
> **Option A — Use `npx -y` to run the server on demand (no Dockerfile change needed):**
> Most MCP servers published to npm can be run with `npx -y <package-name>`. This downloads on first use inside each container.
>
> **Option B — Install the binary permanently in the container:**
> Add an install step to `container/Dockerfile` (e.g., `RUN npm install -g <package>` or `RUN apt-get install -y <binary>`), then rebuild with `./container/build.sh`.
>
> Which do you prefer?

Wait for the user's decision before continuing.

### For SSE servers: verify reachability from inside the container

```bash
docker run --rm --add-host=host.docker.internal:host-gateway nanoclaw-agent:latest curl -sf <url> --max-time 5 -o /dev/null && echo "reachable" || echo "unreachable"
```

Note: The `--add-host` flag is needed on Linux/WSL2 to resolve `host.docker.internal`. Nanoclaw adds this automatically at runtime via `hostGatewayArgs()` in `src/container-runtime.ts`.

If unreachable:
- Confirm the server is actually running on the host
- Use `http://host.docker.internal:<port>` (not `localhost`) — `localhost` inside a container refers to the container itself
- On WSL2, Docker Desktop handles `host.docker.internal` routing automatically

## Phase 3: Modify the Agent Runner

The MCP server is registered in the `query()` call inside `container/agent-runner/src/index.ts`. You need to make two edits to this file:

### Edit 1: Add the tool pattern to `allowedTools`

Locate the `allowedTools` array in the `query()` call. Add `'mcp__<server-name>__*'` after the last existing `mcp__*` entry.

**Example (adding a server named `github`):**
```typescript
      allowedTools: [
        'Bash',
        'Read', 'Write', 'Edit', 'Glob', 'Grep',
        'WebSearch', 'WebFetch',
        'Task', 'TaskOutput', 'TaskStop',
        'TeamCreate', 'TeamDelete', 'SendMessage',
        'TodoWrite', 'ToolSearch', 'Skill',
        'NotebookEdit',
        'mcp__nanoclaw__*',
        'mcp__github__*'
      ],
```

### Edit 2: Add the server config to `mcpServers`

Locate the `mcpServers` block in the same `query()` call. Add a new entry alongside the existing `nanoclaw` entry.

**For a stdio server using `npx` (no env vars needed):**
```typescript
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace/group'],
        },
```

**For a stdio server with environment variables:**
```typescript
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: {
            GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? '',
          },
        },
```

IMPORTANT: `process.env.GITHUB_TOKEN` refers to the **container's** environment, not the host's. This variable will be empty unless you also complete Phase 4 (env var passthrough). Skip Phase 4 only if the server needs no env vars.

**For a custom TypeScript MCP server:**
```typescript
        'my-server': {
          command: 'node',
          args: [path.join(__dirname, 'my-server-mcp-stdio.js')],
          env: {
            MY_VAR: process.env.MY_VAR ?? '',
          },
        },
```

The `__dirname` resolves to `/tmp/dist/` at runtime (where the compiled TypeScript lives). This means a source file at `container/agent-runner/src/my-server-mcp-stdio.ts` compiles to `/tmp/dist/my-server-mcp-stdio.js`.

**For an SSE server:**
```typescript
        obsidian: {
          url: 'http://host.docker.internal:27123/sse',
        },
```

**For an SSE server with auth headers:**
```typescript
        'my-api': {
          url: 'http://host.docker.internal:8080/mcp',
          headers: {
            Authorization: `Bearer ${process.env.MY_API_KEY ?? ''}`,
          },
        },
```

## Phase 4: Pass Environment Variables to the Container (if needed)

**Skip this phase if the MCP server needs no env vars (no API keys, tokens, or config).**

The container's `process.env` only has what Docker passes via `-e` flags. Three files must be modified:

### Step 4a: Add the variable to `.env`

```
MY_SERVER_API_KEY=actual-secret-value
```

### Step 4b: Document in `.env.example`

```
# MCP: <server-name>
MY_SERVER_API_KEY=
```

### Step 4c: Read from `.env` and pass to the container

Edit `src/container-runner.ts`. Locate the `buildContainerArgs()` function.

First, import the env var at the top of `buildContainerArgs()` using `readEnvFile()` (already imported in `src/credential-proxy.ts` — follow that pattern). The function is in `src/env.ts`:

```typescript
import { readEnvFile } from './env.js';
```

Then, add the `-e` flag inside `buildContainerArgs()`, after the existing Anthropic credential env vars (around line 239):

```typescript
  // MCP: <server-name>
  const mcpEnv = readEnvFile(['MY_SERVER_API_KEY']);
  if (mcpEnv.MY_SERVER_API_KEY) {
    args.push('-e', `MY_SERVER_API_KEY=${mcpEnv.MY_SERVER_API_KEY}`);
  }
```

**Why `readEnvFile()` instead of `process.env`?** Nanoclaw deliberately keeps secrets out of `process.env` to prevent them leaking to child processes. `readEnvFile()` reads `.env` directly and returns only the requested keys.

**Security note:** This passes the secret as a Docker `-e` flag, which is visible in `docker inspect`. This matches how Nanoclaw already handles `ANTHROPIC_API_KEY`. For higher security, consider the credential proxy pattern, but that's significantly more complex.

## Phase 5: Add Custom TypeScript MCP Server (if applicable)

**Skip this phase if using `npx -y <package>` or an SSE URL.**

If the MCP server is a custom TypeScript file:

### Step 5a: Create the server source file

Create `container/agent-runner/src/<server-name>-mcp-stdio.ts`. This file must implement a stdio MCP server. Reference `container/agent-runner/src/ipc-mcp-stdio.ts` for the pattern.

### Step 5b: Add npm dependencies (if any)

If the custom server imports packages not already in `container/agent-runner/package.json`:

```bash
cd container/agent-runner && npm install <package-name>
```

This requires rebuilding the container image (Phase 7).

### Step 5c: Copy to existing per-group sessions

Custom `.ts` files must also be synced:

```bash
for dir in data/sessions/*/agent-runner-src; do
  cp container/agent-runner/src/<server-name>-mcp-stdio.ts "$dir/"
done
```

## Phase 6: Sync Agent Runner to Existing Groups

Each group has a cached copy of the agent-runner source at `data/sessions/<group>/agent-runner-src/`. This copy is created once when the group is first created and is never auto-updated. You MUST manually sync changes.

**For global scope (all groups):**
```bash
for dir in data/sessions/*/agent-runner-src; do
  cp container/agent-runner/src/index.ts "$dir/index.ts"
done
```

**For a single group only:**
Edit `data/sessions/<group-folder>/agent-runner-src/index.ts` directly instead of modifying `container/agent-runner/src/index.ts`. The canonical source in `container/` remains unchanged (only affects new groups).

**Verify the sync:**
```bash
for dir in data/sessions/*/agent-runner-src; do
  echo "=== $(dirname $(dirname $dir)) ===" && grep -c 'mcp__<server-name>__' "$dir/index.ts"
done
```

Each group should show `1` (or more) matches.

## Phase 7: Build and Restart

### Step 7a: Rebuild host TypeScript

Always required if you modified `src/container-runner.ts`:

```bash
npm run build
```

Build must be clean. Fix any TypeScript errors before continuing.

### Step 7b: Rebuild container image

Required if you:
- Changed `container/Dockerfile` (new system binary)
- Changed `container/agent-runner/package.json` (new npm dependency)

NOT required if you only changed `container/agent-runner/src/*.ts` (recompiled on each container startup by the entrypoint).

```bash
./container/build.sh
```

### Step 7c: Restart Nanoclaw

```bash
# macOS:
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
# Linux / WSL2:
systemctl --user restart nanoclaw
# Or if running manually:
# Kill the existing process and re-run npm start
```

## Phase 8: Verify

Tell the user:

> The `<server-name>` MCP server is now registered. On the next container run, the agent will have access to its tools.
>
> Send a message asking the agent to use the new tools:
> "Use `<server-name>` to [describe what the tool does]"
>
> If the agent doesn't seem to find the tools, check:
> ```bash
> tail -f store/logs/nanoclaw.log | grep -i mcp
> ```

## Troubleshooting

### Agent says tool not found / doesn't use the new server

1. **`allowedTools` missing**: Confirm `mcp__<name>__*` is in the `allowedTools` array in `index.ts`
2. **`mcpServers` missing**: Confirm the server entry exists in the `mcpServers` block
3. **Per-group not synced**: Re-run the copy command from Phase 6. Remember, existing groups don't auto-update
4. **Check logs**: `grep -i "mcp\|<server-name>" store/logs/nanoclaw.log`

### stdio server fails to start inside container

Test the exact command in an isolated container:

```bash
docker run --rm -it nanoclaw-agent:latest <command> <args>
```

Common issues:
- **Package not found**: Use full `npx -y <package>` form (the `-y` flag auto-confirms installation)
- **Binary missing**: Install in Dockerfile or switch to npx
- **Wrong paths**: Container paths differ from host. Workspace is at `/workspace/group`, not the host CWD. IPC at `/workspace/ipc`, home at `/home/node`

### Environment variable is empty inside the container

This is the most common issue. Verify the full chain:

1. **`.env` has the value**: `grep MY_VAR .env`
2. **`buildContainerArgs()` passes it**: Check `src/container-runner.ts` has the `-e` flag with `readEnvFile()`
3. **Host code rebuilt**: `npm run build` after changing `src/container-runner.ts`
4. **Service restarted**: The running process still uses the old code until restarted
5. **Agent-runner references it**: `process.env.MY_VAR` in the `mcpServers` env config

To debug, temporarily add a log line to the agent-runner:
```typescript
log(`MY_VAR present: ${!!process.env.MY_VAR}`);
```
Then check container stderr in `store/logs/nanoclaw.log`.

### SSE server connection refused

- `localhost` inside a container is the container itself. Use `host.docker.internal:<port>` to reach the host
- Verify the SSE server is running: `curl http://localhost:<port>` from the host
- Verify Docker can reach it: `docker run --rm --add-host=host.docker.internal:host-gateway curlimages/curl curl -sf http://host.docker.internal:<port>`
- On WSL2, Docker Desktop handles `host.docker.internal` routing. If using Docker Engine directly on Linux, `--add-host=host.docker.internal:host-gateway` is added automatically by `hostGatewayArgs()` in `src/container-runtime.ts`

### Custom TypeScript MCP server has import errors

- Ensure dependencies are in `container/agent-runner/package.json` and container image was rebuilt
- The entrypoint symlinks `/app/node_modules` to `/tmp/dist/node_modules` — so packages installed in the image at `/app/node_modules` are available to compiled code
- TypeScript compilation happens at container startup (`npx tsc --outDir /tmp/dist`). Check stderr for compile errors in the logs
