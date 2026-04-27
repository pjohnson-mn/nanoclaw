# Adding Custom Skills and Subagents

How to extend your NanoClaw bot with custom container skills and subagents. Covers where files live, how they're mounted into containers, and what (if anything) needs restarting.

---

## Container Skills

Container skills are instruction sets (and optionally code) that get loaded into every agent session. They live in `container/skills/` on the host and are bind-mounted read-only into the container.

### File Structure

Each skill is a directory with at minimum a `SKILL.md`:

```
container/skills/<skill-name>/
  SKILL.md              # Required — frontmatter (name, description) + skill content
  instructions.md       # Optional — auto-composed into the agent's CLAUDE.md
  *.ts / *.js / etc.    # Optional — supporting code, also mounted RO
```

The `SKILL.md` frontmatter format:

```yaml
---
name: my-skill
description: One-line description of what this skill does
---

# Skill content (markdown)
```

If your skill includes an `instructions.md`, it will be automatically symlinked into the agent's `.claude-fragments/` directory and `@`-imported into the composed `CLAUDE.md` at every container spawn. This is how the agent discovers the skill's instructions.

### Path Mapping

| Location | Path |
|----------|------|
| **Host** | `container/skills/<skill-name>/` |
| **Container** | `/app/skills/<skill-name>/` |
| **Mount type** | Bind mount, read-only |

### Restart / Rebuild Requirements

| Change | Container Restart | Container Rebuild |
|--------|:-:|:-:|
| Add a new skill directory | Yes | No |
| Edit `SKILL.md` or `instructions.md` | Yes | No |
| Edit supporting code files | No (mounted RO, read live) | No |

**Why restart but no rebuild?** The skill directory is bind-mounted from the host (`container/skills/` -> `/app/skills/`), so file content changes are visible immediately inside the container. However, the `CLAUDE.md` composition that wires `instructions.md` into the agent's context runs at spawn time, so a new skill or changed instructions won't be picked up until the next container start.

---

## MCP Tool Instruction Fragments

Built-in MCP tool modules can ship a sibling `<name>.instructions.md` that gets auto-composed into every agent's `CLAUDE.md`. These describe how the agent should use that module's tools.

### Path Mapping

| Location | Path |
|----------|------|
| **Host** | `container/agent-runner/src/mcp-tools/<name>.instructions.md` |
| **Container** | `/app/src/mcp-tools/<name>.instructions.md` |
| **Mount type** | Bind mount, read-only (parent dir mounted) |

### Existing Modules

- `agents.instructions.md` — `create_agent`
- `core.instructions.md` — `send_message`, `fetch_file`, etc.
- `interactive.instructions.md` — `send_card`, `send_poll`
- `scheduling.instructions.md` — `schedule_task`, etc.
- `self-mod.instructions.md` — `install_packages`, `add_mcp_server`

### Restart / Rebuild Requirements

| Change | Container Restart | Container Rebuild |
|--------|:-:|:-:|
| Add a new `.instructions.md` | Yes | No |
| Edit an existing `.instructions.md` | Yes | No |
| Add/edit MCP tool `.ts` source | No (Bun reads TS live) | No |

Same logic as skills: the instruction content is composed into `CLAUDE.md` at spawn time, but the source code itself is bind-mounted and read live.

---

## MCP Server Architecture

NanoClaw agents access tools through the [Model Context Protocol](https://modelcontextprotocol.io/). Every agent container has at least one MCP server (the built-in `nanoclaw` server); additional servers can be wired in via `container.json` or at runtime through the `add_mcp_server` self-modification tool.

### How the MCP server starts

The agent-runner entry point (`container/agent-runner/src/index.ts`) builds an MCP server map and passes it to the Claude SDK via the provider's `mcpServers` option. The SDK spawns each server as a child process using stdio transport.

```
agent-runner startup
  ↓
Build MCP server map:
  1. nanoclaw (built-in) — bun run /app/src/mcp-tools/index.ts
  2. each entry in container.json mcpServers
  ↓
Pass map to ClaudeProvider → SDK spawns each as a child process
  ↓
SDK discovers tools via MCP ListTools, makes them available as mcp__<server>__<tool>
```

The built-in server is always named `nanoclaw`, so its tools appear as `mcp__nanoclaw__send_message`, `mcp__nanoclaw__schedule_task`, etc.

### Built-in nanoclaw MCP server

**Source:** `container/agent-runner/src/mcp-tools/`

The server uses `@modelcontextprotocol/sdk` with stdio transport (`server.ts`). Tool modules self-register via `registerTools()` at import time — the barrel file (`index.ts`) imports each module for its side effect, then calls `startMcpServer()`.

**Adding a new built-in tool module:**

1. Create `container/agent-runner/src/mcp-tools/<name>.ts`
2. Define tools using the `McpToolDefinition` interface (from `types.ts`):
   ```typescript
   import { registerTools } from './server.js';
   import type { McpToolDefinition } from './types.js';

   const myTool: McpToolDefinition = {
     tool: {
       name: 'my_tool',
       description: 'What this tool does',
       inputSchema: {
         type: 'object',
         properties: { /* ... */ },
         required: ['param1'],
       },
     },
     async handler(args) {
       // Implementation
       return { content: [{ type: 'text', text: 'result' }] };
     },
   };

   registerTools([myTool]);
   ```
3. Add `import './<name>.js';` to `index.ts`
4. Optionally create `<name>.instructions.md` alongside it — this gets auto-composed into every agent's `CLAUDE.md` (see [MCP Tool Instruction Fragments](#mcp-tool-instruction-fragments) above)

No container rebuild needed — the source is bind-mounted RO from the host and Bun reads TypeScript directly. A container restart is needed only if you added an `instructions.md` (composed at spawn time).

#### Tool modules and their tools

| Module | Tools | Purpose |
|--------|-------|---------|
| `core.ts` | `send_message`, `send_file`, `edit_message`, `add_reaction` | Outbound messaging — all tools resolve destinations via the local destination map in `inbound.db` |
| `scheduling.ts` | `schedule_task`, `list_tasks`, `update_task`, `cancel_task`, `pause_task`, `resume_task` | Durable task scheduling with optional pre-task bash scripts |
| `interactive.ts` | `ask_user_question`, `send_card` | Interactive prompts (blocking question with choices) and structured cards |
| `agents.ts` | `create_agent` | Spawn a new long-lived agent group with bidirectional messaging |
| `self-mod.ts` | `install_packages`, `add_mcp_server` | Self-modification — both require admin approval, fire-and-forget |

All tools write to `outbound.db` (`messages_out` table) or use destination routing from `inbound.db`. The host picks up outbound rows in its delivery poll and dispatches them.

### Custom MCP servers via `container.json`

External MCP servers are declared in the per-group `container.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "pnpm",
      "args": ["dlx", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "placeholder" },
      "instructions": "Use github tools for repo operations..."
    }
  }
}
```

**Fields:**

| Field | Required | Description |
|-------|:--------:|-------------|
| `command` | Yes | Executable to run (e.g., `pnpm`, `npx`, `node`, `bun`) |
| `args` | No | Command arguments array |
| `env` | No | Environment variables passed to the server process |
| `instructions` | No | Always-in-context guidance, written to `.claude-fragments/mcp-<name>.md` and composed into the agent's `CLAUDE.md` at spawn |

**How it flows:**

1. Host reads `container.json` at spawn time (`src/container-config.ts:readContainerConfig()`)
2. If `instructions` is set, `composeGroupClaudeMd()` writes it to `.claude-fragments/mcp-<name>.md` and imports it into the composed `CLAUDE.md`
3. The agent-runner reads `container.json` at startup, merges custom servers into the MCP map alongside the built-in `nanoclaw` server
4. The SDK spawns each server as a child process and discovers its tools via `ListTools`
5. Tools appear as `mcp__<server-name>__<tool-name>` in the agent's tool list

**Credentials:** Don't embed secrets in `container.json` `env` fields. MCP servers that need API keys should use placeholder values — the OneCLI gateway intercepts outbound HTTPS requests and injects credentials from the vault based on host patterns. See [CLAUDE.md § Secrets / Credentials / OneCLI](../CLAUDE.md#secrets--credentials--onecli).

### Adding MCP servers at runtime (`add_mcp_server`)

Agents can request new MCP servers through the `add_mcp_server` self-modification tool. This is a two-phase approval flow:

```
Agent calls add_mcp_server MCP tool (container side)
  ↓
Tool writes a system action row to outbound.db
  ↓
Host delivery poll picks it up → src/modules/self-mod/request.ts
  ↓
Host-side validation (name + command required)
  ↓
Approval request sent to admin (via approvals module)
  ↓
Admin approves → src/modules/self-mod/apply.ts:applyAddMcpServer()
  ↓
container.json updated with new mcpServers entry
  ↓
Container killed → host sweep respawns on next message
  ↓
New container reads updated container.json → MCP server available
```

No image rebuild is needed — `add_mcp_server` only updates `container.json` and restarts the container. The new server is spawned by the SDK on the next startup.

### MCP server lifecycle

| Event | What happens to MCP servers |
|-------|-----------------------------|
| **Container spawn** | SDK spawns all servers from the merged map (nanoclaw + container.json entries) as child processes |
| **Container running** | Servers run as long as the container lives; SDK manages stdio transport |
| **Container exit** | All MCP server processes are killed with the container |
| **`add_mcp_server` approved** | Container killed; next spawn picks up the new server from updated `container.json` |
| **`install_packages` approved** | Image rebuilt, container killed; MCP servers are unaffected (same `container.json`) |
| **container.json edited manually** | Takes effect on next container restart (host doesn't watch for changes) |

### SDK tool visibility

The Claude SDK presents MCP tools using the `mcp__<server>__<tool>` naming convention. The agent's tool allowlist (`container/agent-runner/src/providers/claude.ts`) includes `mcp__nanoclaw__*` to permit all built-in nanoclaw tools. Custom MCP server tools are allowed by default — the SDK doesn't restrict them unless `disallowedTools` explicitly names them.

The SDK also exposes its own built-in tools (Bash, Read, Write, Edit, etc.). NanoClaw's provider configuration explicitly allows a curated set and disallows tools that don't fit the headless container model:

**Allowed:** `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `Task`, `TaskOutput`, `TaskStop`, `TeamCreate`, `TeamDelete`, `SendMessage`, `TodoWrite`, `ToolSearch`, `Skill`, `NotebookEdit`, `mcp__nanoclaw__*`

**Disallowed:** `CronCreate`, `CronDelete`, `CronList`, `ScheduleWakeup` (NanoClaw has its own durable scheduling), `AskUserQuestion` (SDK version returns a placeholder; NanoClaw's MCP version blocks on a real reply), `EnterPlanMode`, `ExitPlanMode`, `EnterWorktree`, `ExitWorktree` (UI affordances that would hang in a headless container)

---

## Claude Code Agent Definitions (`.claude/agents/*.md`)

Claude Code supports custom agent types defined as markdown files in `.claude/agents/`. Inside a NanoClaw container, the `.claude/` directory is the `.claude-shared` state directory, mounted RW at `/home/node/.claude`. Dropping `.md` files into the `agents/` subdirectory makes them available as `subagent_type` options for the Claude Code `Agent` tool.

These are lightweight, stateless agents — they spin up within the same container session, run to completion, and return a result. No new container is spawned. Use these for focused sub-tasks (research, code review, file search) that don't need their own persistent memory or workspace.

### File Structure

```
data/v2-sessions/<agent-group-id>/.claude-shared/agents/
  researcher.md       # Available as subagent_type: "researcher"
  code-reviewer.md    # Available as subagent_type: "code-reviewer"
```

Each file is a markdown document with YAML frontmatter. The filename (minus `.md`) becomes the agent type name:

```markdown
---
name: researcher
description: Research agent for deep-diving into topics
model: sonnet
tools:
  - WebSearch
  - WebFetch
  - Read
  - Bash
---

You are a research agent. Your job is to thoroughly investigate a topic
and return a concise summary of findings.

## Rules
- Cite sources when possible
- Keep responses under 500 words unless asked for detail
```

### Path Mapping

| Location | Path |
|----------|------|
| **Host** | `data/v2-sessions/<agent-group-id>/.claude-shared/agents/<name>.md` |
| **Container** | `/home/node/.claude/agents/<name>.md` |
| **Mount type** | Bind mount, read-write (parent `.claude-shared` dir) |

### Per-Group vs Shared

Agent definitions live inside each agent group's `.claude-shared` directory, so they are **per-group** by default. If you want the same agent definitions available to all groups, you have two options:

1. **Copy the files** into each group's `.claude-shared/agents/` directory
2. **Use a shared mount** — add the agents directory as an additional mount in each group's `container.json`, or create a script that symlinks/copies them at spawn time

### Restart / Rebuild Requirements

| Change | Container Restart | Container Rebuild |
|--------|:-:|:-:|
| Add a new agent `.md` file | No | No |
| Edit an existing agent `.md` file | No | No |
| Remove an agent `.md` file | No | No |

The `.claude-shared` directory is mounted RW and Claude Code reads agent definitions on demand. No restart or rebuild is needed — changes are visible immediately to the running container.

### Comparison: Agent Definitions vs `create_agent`

| | Agent Definitions (`.claude/agents/*.md`) | `create_agent` MCP tool |
|---|---|---|
| **What it creates** | Stateless sub-task within the same container | Full agent group with its own container |
| **Persistence** | None — result returned, agent gone | Permanent — own workspace, memory, session DBs |
| **Communication** | Return value only | Bidirectional messaging via destinations |
| **Use case** | Quick focused tasks (search, review, analysis) | Long-lived companions and collaborators |
| **Container** | Runs in the parent's container | Gets its own container |
| **Restart needed** | No | N/A (new container spawns) |

---

## Subagents (via `create_agent`)

Subagents are full agent groups created at runtime by an existing agent. They get their own container, workspace, session DBs, and persistent memory.

### How They're Created

1. An agent calls the `create_agent` MCP tool with a `name` and optional `instructions`
2. The host creates a new agent group row in the central DB
3. A new group directory is scaffolded at `groups/<normalized-name>/`
4. Bidirectional destination rows are inserted (parent can message child by name, child can message parent as "parent")
5. The `instructions` string seeds `CLAUDE.local.md` in the new group

### Path Mapping (per subagent)

| Location | Path |
|----------|------|
| **Host — group dir** | `groups/<agent-folder>/` |
| **Container** | `/workspace/agent/` (RW) |
| **Host — session DBs** | `data/v2-sessions/<agent-group-id>/<session-id>/` |
| **Container** | `/workspace/` (inbound.db RO, outbound.db RW) |
| **Host — Claude state** | `data/v2-sessions/<agent-group-id>/.claude-shared/` |
| **Container** | `/home/node/.claude` (RW) |

### What Subagents Inherit

Subagents get the **same container image** and **same shared source mounts** as the parent:

| Mount | Container Path | Source |
|-------|----------------|--------|
| Agent runner source | `/app/src` | `container/agent-runner/src/` (RO) |
| Built-in skills | `/app/skills` | `container/skills/` (RO) |
| Shared CLAUDE.md | `/app/CLAUDE.md` | `container/CLAUDE.md` (RO) |

They do **not** inherit:
- The parent's `CLAUDE.local.md` (they get their own, seeded from `instructions`)
- The parent's `container.json` customizations (new group gets default config)
- The parent's additional mounts or MCP servers

### Restart / Rebuild Requirements

| Change | Container Restart | Container Rebuild |
|--------|:-:|:-:|
| Creating a subagent | N/A (new container spawns) | No |
| Editing a subagent's `CLAUDE.local.md` | No (RW, read live) | No |
| Editing a subagent's `container.json` | Yes | No |

---

## Per-Group Configuration (`container.json`)

Each agent group (including subagents) can have a `container.json` in its group directory that controls MCP servers, additional mounts, and other container-level config.

### Path Mapping

| Location | Path |
|----------|------|
| **Host** | `groups/<folder>/container.json` |
| **Container** | `/workspace/agent/container.json` (RO overlay) |

### MCP Server Instructions in `container.json`

External MCP servers declared in `container.json` can include an `instructions` field. These are written as inline fragments into `.claude-fragments/mcp-<name>.md` and composed into the agent's `CLAUDE.md` at spawn time.

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["my-mcp-server"],
      "instructions": "How the agent should use this server's tools..."
    }
  }
}
```

---

## Additional Host Mounts

You can mount host directories into agent containers via `container.json`'s `additionalMounts` array. These are validated at spawn time against `~/.config/nanoclaw/mount-allowlist.json`.

### Path Mapping

| Location | Path |
|----------|------|
| **Host** | Any allowlisted path |
| **Container** | `/workspace/extra/<basename>` |

### Security

Mounts are blocked if they match sensitive patterns (`.ssh`, `.env`, credentials, etc.). The allowlist must be configured on the host before mounts will work.

---

## Summary: Everything at a Glance

| What | Host Path | Container Path | RW/RO | Restart Needed | Rebuild Needed |
|------|-----------|----------------|-------|:-:|:-:|
| Container skill dir | `container/skills/<name>/` | `/app/skills/<name>/` | RO | Yes (for new skills or instruction changes) | No |
| Skill supporting files | `container/skills/<name>/*.ts` | `/app/skills/<name>/*.ts` | RO | No (mounted live) | No |
| MCP tool instructions | `container/agent-runner/src/mcp-tools/<name>.instructions.md` | `/app/src/mcp-tools/<name>.instructions.md` | RO | Yes (composed at spawn) | No |
| MCP tool source | `container/agent-runner/src/mcp-tools/<name>.ts` | `/app/src/mcp-tools/<name>.ts` | RO | No (Bun reads live) | No |
| Agent runner source | `container/agent-runner/src/` | `/app/src` | RO | No (Bun reads live) | No |
| Group workspace | `groups/<folder>/` | `/workspace/agent/` | RW | No | No |
| `CLAUDE.local.md` | `groups/<folder>/CLAUDE.local.md` | `/workspace/agent/CLAUDE.local.md` | RW | No | No |
| `container.json` | `groups/<folder>/container.json` | `/workspace/agent/container.json` | RO | Yes | No |
| Composed `CLAUDE.md` | `groups/<folder>/CLAUDE.md` | `/workspace/agent/CLAUDE.md` | RO | Yes (regenerated at spawn) | No |
| Shared base CLAUDE.md | `container/CLAUDE.md` | `/app/CLAUDE.md` | RO | Yes (composed at spawn) | No |
| Session DBs | `data/v2-sessions/<gid>/<sid>/` | `/workspace/` | Mixed | N/A | No |
| Claude state | `data/v2-sessions/<gid>/.claude-shared/` | `/home/node/.claude` | RW | No | No |
| Agent definitions | `data/v2-sessions/<gid>/.claude-shared/agents/<name>.md` | `/home/node/.claude/agents/<name>.md` | RW | No | No |
| Additional mounts | Allowlisted host path | `/workspace/extra/<basename>` | Configurable | Yes | No |

**Key takeaway:** Nothing requires a container image rebuild unless you're adding system packages (apt) or global npm CLIs. All source code and skills are bind-mounted from the host. The only reason to restart a container is to trigger `CLAUDE.md` recomposition (which runs at spawn time) when you add new skills or change instruction files.
