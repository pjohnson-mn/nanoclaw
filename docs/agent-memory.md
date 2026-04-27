# Agent Memory

How a NanoClaw agent builds and retains context across turns and container restarts. "Memory" here means everything the agent can draw on when processing a message — instructions, conversation history, archived transcripts, workspace files, and session state.

## Overview

An agent's effective memory is assembled from seven sources, loaded at different times:

| Source | Scope | Persistence | Loaded when |
|--------|-------|-------------|-------------|
| [Composed CLAUDE.md](#composed-claudemd) | Per-group | Regenerated each spawn | SDK startup |
| [CLAUDE.local.md](#claudelocalmd) | Per-group | Permanent (RW) | SDK startup |
| [System prompt addendum](#system-prompt-addendum) | Per-session | Regenerated each query | Every turn |
| [SDK transcript](#sdk-transcript-conversation-history) | Per-group | Until compaction | SDK resume |
| [Conversation archive](#conversation-archive) | Per-group | Permanent (RW) | Agent file reads |
| [Workspace files](#workspace-files) | Per-group | Permanent (RW) | Agent file reads |
| [Inbound messages](#inbound-messages) | Per-session | Until completed | Poll loop |

## Composed CLAUDE.md

**File:** `groups/<folder>/CLAUDE.md` (host-generated, mounted RO at `/workspace/agent/CLAUDE.md`)

**When:** Regenerated atomically on every container spawn by `src/claude-md-compose.ts:composeGroupClaudeMd()`. The agent cannot edit this file — it's a read-only nested mount.

**What it contains:** An import-only entry point that pulls in:

1. **Shared base** — `container/CLAUDE.md`, mounted RO at `/app/CLAUDE.md`. Contains the global agent instructions: communication style, workspace layout, memory management guidelines, and conversation archive usage. Identical across all agents.

2. **Skill fragments** — each skill in `container/skills/<name>/` that ships an `instructions.md` gets a symlink at `.claude-fragments/skill-<name>.md` pointing to `/app/skills/<name>/instructions.md`. These describe skill-specific behaviors (browser automation, Slack formatting, etc.).

3. **MCP module fragments** — each built-in MCP tool module in `container/agent-runner/src/mcp-tools/` that ships a `<name>.instructions.md` gets a symlink at `.claude-fragments/module-<name>.md`. These describe how to use scheduling, self-modification, interactive questions, etc.

4. **Custom MCP server instructions** — inline `instructions` fields from `container.json` `mcpServers` entries are written as `.claude-fragments/mcp-<name>.md`.

The composed file looks like:

```markdown
<!-- Composed at spawn — do not edit. Edit CLAUDE.local.md for per-group content. -->
@./.claude-shared.md
@./.claude-fragments/module-core.md
@./.claude-fragments/module-scheduling.md
@./.claude-fragments/skill-welcome.md
```

Stale fragments are pruned on each compose — if a skill is removed from `container.json`, its fragment disappears on the next spawn.

## CLAUDE.local.md

**File:** `groups/<folder>/CLAUDE.local.md` (mounted RW at `/workspace/agent/CLAUDE.local.md`)

**When:** Auto-loaded by the Claude SDK at startup via `settingSources: ['project', 'user']`. The SDK treats this as a project-local CLAUDE.md variant.

**What it contains:** Per-group agent memory. This is the agent's primary durable knowledge store — personality, user preferences, project context, and an index of any structured files the agent creates. The shared base (`container/CLAUDE.md`) instructs the agent to maintain this file:

> Record things there that you'll want to remember in future sessions — user preferences, project context, recurring facts. Keep entries short and structured.

Created empty (or seeded with `--instructions` content) on first group init by `src/group-init.ts`. The agent can read and write it freely. Survives container restarts and recomposition.

## System prompt addendum

**Built by:** `container/agent-runner/src/destinations.ts:buildSystemPromptAddendum()`

**When:** Generated once at agent-runner startup, injected into every SDK query via `systemPrompt: { type: 'preset', preset: 'claude_code', append: instructions }`.

**What it contains:**

1. **Agent identity** — the agent's name from `container.json` (`assistantName`), presented as "You are X."
2. **Destination map** — a live list of where the agent can send messages (channels, other agents), with syntax instructions for `<message to="...">` blocks or single-destination shortcut.

The destination map is queried from `inbound.db`'s `destinations` table, which the host rewrites on every container wake. Changes to wiring take effect on the next spawn without editing any file.

## SDK transcript (conversation history)

**Location:** `data/v2-sessions/<agent_group_id>/.claude-shared/` (mounted RW at `/home/node/.claude/`)

**When:** The Claude SDK reads/writes transcript files (`.jsonl`) automatically. On resume, the SDK replays the stored transcript to rebuild the agent's conversational context.

**How resumption works:**

1. On SDK `init` event, the poll loop (`container/agent-runner/src/poll-loop.ts:291`) immediately persists the SDK session ID to `outbound.db`'s `session_state` table.
2. On next container spawn, the poll loop reads the stored session ID (`container/agent-runner/src/db/session-state.ts:getStoredSessionId()`).
3. The session ID is passed to the provider as `continuation`, which the SDK uses to locate and replay the transcript `.jsonl` file.
4. If the transcript is missing or corrupt, the provider detects the stale session error and clears the continuation — the next message starts a fresh conversation.

Mid-turn crash recovery: because the session ID is written on `init` (not on `result`), a container crash mid-turn still allows the next spawn to resume the conversation.

**The `/clear` command** (`poll-loop.ts:95-106`) clears the stored session ID, starting a fresh conversation with no prior transcript.

## Conversation archive

**Location:** `/workspace/agent/conversations/` (inside the group dir, so `groups/<folder>/conversations/`)

**When:** Written by the `PreCompact` hook (`container/agent-runner/src/providers/claude.ts:181-222`) when the Claude SDK compacts the context window.

**How it works:**

1. The SDK triggers compaction when the context approaches `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (165,000 tokens, set in `claude.ts:230`).
2. The `PreCompact` hook reads the raw transcript `.jsonl`, parses user/assistant messages, and writes a Markdown summary to `conversations/<date>-<title>.md`.
3. The title is derived from the SDK's session summary (if available in `sessions-index.json`) or falls back to `conversation-HHMM`.
4. Message content is truncated to 2,000 characters per message in the archive.

**Format:**

```markdown
# <Summary or Conversation>

Archived: Apr 23, 10:30 AM

---

**User**: message text...

**Assistant**: response text...
```

The agent can search and read these files to recall prior context. The shared base instructions tell the agent:

> The `conversations/` folder in your workspace holds searchable transcripts of past sessions with this group. Use it to recall prior context when a request references something that happened before.

## Workspace files

**Location:** `/workspace/agent/` (mounted RW from `groups/<folder>/`)

**When:** Read on demand by the agent using `Read`, `Grep`, `Glob` tools.

**What it contains:** Any files the agent creates during its work — notes, research, structured data files. The shared base instructs the agent to build organized information systems:

> Create a system for storing the information depending on its type - e.g. create a file of people that the user mentions so you can keep track or a file of projects. For every file you create, add a concise reference in your CLAUDE.local.md so you'll be able to find it in future conversations.

The agent is encouraged to split files over ~500 lines into folders with an index, and to prefer dedicated structured files (`customers.md`, `preferences.md`) over conversation archives for long-lived data.

## Inbound messages

**Location:** `data/v2-sessions/<agent_group_id>/<session_id>/inbound.db`

**When:** Polled every 1 second (idle) or 500ms (active query) by the agent-runner's poll loop.

**What it contains:** The `messages_in` table holds all messages routed to this session by the host — chat messages, scheduled tasks, webhooks, and system responses. Each message has:

- `kind` — `chat`, `chat-sdk`, `task`, `webhook`, or `system`
- `content` — JSON with text, sender, attachments, timestamps
- `trigger` — `1` (wake the agent) or `0` (context-only, accumulated but doesn't trigger a turn)
- `process_after` / `recurrence` — for scheduled tasks

Messages are formatted into XML by `container/agent-runner/src/formatter.ts` before reaching the agent. Chat messages get `<message>` tags with sender, timestamp, source channel, and optional reply context. A `<context timezone="..." />` header is prepended so the agent knows the user's timezone.

The poll loop caps each prompt to `maxMessagesPerPrompt` messages (default 10, configurable in `container.json`). Messages are fetched newest-first then reversed to chronological order. Accumulated context (trigger=0) rides along with wake-eligible messages.

## Settings

**File:** `data/v2-sessions/<agent_group_id>/.claude-shared/settings.json` (mounted at `/home/node/.claude/settings.json`)

**When:** Loaded by the Claude SDK at startup.

**What it contains:** SDK environment overrides:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD": "1",
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "0"
  }
}
```

`CLAUDE_CODE_DISABLE_AUTO_MEMORY` is set to `"0"` (enabled), meaning the SDK's built-in auto-memory feature is active. `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` enables the SDK to load CLAUDE.md files from additional mounted directories.

## Container skills

**Location:** `container/skills/<name>/` (mounted RO at `/app/skills/`)

**When:** Skill symlinks are synced at spawn time by `src/container-runner.ts:syncSkillSymlinks()`. Each skill's `instructions.md` is also imported via the composed CLAUDE.md fragments.

Skills are selected per-group via `container.json`'s `skills` field — either an array of names or `"all"`. The symlinks in `data/v2-sessions/<agent_group_id>/.claude-shared/skills/` point to `/app/skills/<name>` (valid inside the container). The SDK discovers these as part of the `/home/node/.claude/` directory.

## Additional directories

**Location:** Mounted at `/workspace/extra/<name>/` from `container.json` `additionalMounts`

**When:** Discovered at agent-runner startup (`container/agent-runner/src/index.ts:57-69`) and passed to the SDK as `additionalDirectories`. The SDK loads any CLAUDE.md files found in these directories.

These are host directories the operator explicitly mounts into the container — project repos, shared data, etc. The agent can read/write them (depending on mount permissions) and the SDK includes their CLAUDE.md files in context.

## Loading timeline

### Container spawn (host side)

1. `initGroupFilesystem()` — create/verify `groups/<folder>/` structure (idempotent)
2. `syncSkillSymlinks()` — align `.claude-shared/skills/` to `container.json` selection
3. `composeGroupClaudeMd()` — regenerate `CLAUDE.md` from shared base + fragments
4. `ensureRuntimeFields()` — write current agent identity into `container.json`
5. Write destinations table and session routing into `inbound.db`
6. Spawn container with all mounts

### Agent-runner startup (container side)

1. Load `container.json` from `/workspace/agent/container.json` (RO)
2. Build system prompt addendum (identity + destinations)
3. Discover additional directories at `/workspace/extra/`
4. Configure MCP servers (nanoclaw built-in + custom)
5. Create provider with hooks (PreToolUse, PostToolUse, PreCompact)
6. Enter poll loop:
   - Load SDK session ID from `outbound.db` `session_state`
   - If found, pass as `continuation` to resume prior transcript
   - SDK loads: composed `CLAUDE.md`, `CLAUDE.local.md`, `settings.json`, skills
   - On `init` event: persist new session ID immediately
   - On `result` event: dispatch response to destinations

## Mount map

Complete mount layout inside the container:

```
/workspace/                          ← session dir (RW)
  inbound.db                         ← host-owned, container reads only
  outbound.db                        ← container-owned
  .heartbeat                         ← liveness touch file
  outbox/                            ← outbound file attachments
  agent/                             ← groups/<folder>/ (RW)
    CLAUDE.md                        ← composed entry (RO nested mount)
    CLAUDE.local.md                  ← per-group memory (RW)
    container.json                   ← config (RO nested mount)
    .claude-shared.md                ← symlink → /app/CLAUDE.md
    .claude-fragments/               ← fragment dir (RO nested mount)
      skill-*.md                     ← skill instruction symlinks
      module-*.md                    ← MCP module instruction symlinks
      mcp-*.md                       ← custom MCP inline instructions
    conversations/                   ← archived transcripts (RW)
    <agent-created files>            ← notes, structured data (RW)
  global/                            ← groups/global/ (RO, if exists)
  extra/<name>/                      ← additional mounts (per config)
/app/
  CLAUDE.md                          ← shared base (RO)
  src/                               ← agent-runner source (RO)
  skills/                            ← shared skills (RO)
/home/node/.claude/                  ← SDK state (RW)
  settings.json                      ← env overrides
  skills/<name>/                     ← skill symlinks → /app/skills/<name>
  sessions/<id>/<uuid>.jsonl         ← SDK conversation transcripts
  sessions-index.json                ← session metadata + summaries
```

## Memory lifecycle

```
New message arrives
  ↓
Host writes to inbound.db → wakes container
  ↓
Poll loop reads pending messages, formats as XML prompt
  ↓
SDK resumes from stored transcript (if continuation exists)
  ↓
Agent processes with full context:
  - System prompt (identity + destinations)
  - Composed CLAUDE.md (shared base + skill/module fragments)
  - CLAUDE.local.md (per-group memory)
  - SDK transcript (prior conversation turns)
  - Inbound messages (new messages this turn)
  ↓
Agent may read workspace files (conversations/, structured data)
  ↓
Agent may update CLAUDE.local.md or create/update workspace files
  ↓
If context hits 165k tokens → PreCompact hook archives transcript
  to conversations/<date>-<title>.md, then SDK compacts
  ↓
Container exits → session ID persisted in outbound.db
  ↓
Next message → container respawns → resumes from session ID
```
