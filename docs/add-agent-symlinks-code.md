# Agent Symlinks Support

## What was added

Subagent `.md` files now follow the same pattern as skills:

- Source files live in `container/agents/`
- Mounted read-only at `/app/agents/` inside the container
- `syncAgentSymlinks()` creates symlinks in `.claude-shared/agents/` → `/app/agents/<name>.md`
- Claude Code discovers them at `/home/node/.claude/agents/` (where `.claude-shared/` is mounted)

## Files changed

### `src/container-runner.ts`

**Mount** — added alongside the skills mount:

```ts
const agentsSrc = path.join(projectRoot, 'container', 'agents');
if (fs.existsSync(agentsSrc)) {
  mounts.push({ hostPath: agentsSrc, containerPath: '/app/agents', readonly: true });
}
```

**Sync call** — added alongside `syncSkillSymlinks()` in `buildMounts()`:

```ts
syncAgentSymlinks(claudeDir);
```

**`syncAgentSymlinks()`** — mirrors `syncSkillSymlinks()` but operates on individual `.md` files rather than directories:

```ts
function syncAgentSymlinks(claudeDir: string): void {
  // ensures .claude-shared/agents/ exists
  // reads container/agents/*.md
  // removes stale symlinks
  // creates symlinks: .claude-shared/agents/<name>.md → /app/agents/<name>.md
}
```

### `container/agent-runner/src/providers/claude.ts`

Added `'Agent'` to `TOOL_ALLOWLIST` so the SDK's Agent tool is not blocked:

```ts
const TOOL_ALLOWLIST = [
  'Agent',
  'Bash',
  // ...
];
```

This required a container rebuild (`./container/build.sh`).

## How to add agents

Drop `.md` files into `container/agents/`. They are picked up automatically on the next container spawn — no config change needed.

## Difference from skills

Skills symlink directories (each skill is a folder). Agents symlink individual `.md` files. There is no per-group enable/disable for agents — all files in `container/agents/` are always available.
