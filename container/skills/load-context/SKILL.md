---
name: load-context
description: Reads relevant context files from ~/.claude/context/ before answering. Use proactively when a request involves a specific domain, person, project, or topic that might have a dedicated context file.
allowed-tools: Bash(*), Read(*)
---

# Load Context Skill

Reads relevant `.md` files from `~/.claude/context/` so responses are grounded in the user's personal context for that topic.

## When to invoke

Use **proactively** before answering when the request involves:
- A specific person, team, or relationship
- A project, system, or product the user works on
- A recurring domain (work, health, finance, calendar, email, notes, etc.)
- Anything where "what do I already know about X" could meaningfully improve the answer

**Skip if:**
- Context has already been loaded in this session
- The request is purely technical/generic with no personal domain component

## Workflow

### Step 1: List available context files

```bash
ls ~/.claude/context/ 2>/dev/null
```

If the directory is empty or missing, skip the rest — no context to load.

### Step 2: Decide which files are relevant

Match filenames against the topic of the request. Use judgement:

| Request involves... | Likely relevant files |
|---|---|
| Work, job, team, meetings | `work.md`, `email-and-calendar.md` |
| Personal info, family, contacts | `me.md` |
| Goals, priorities, focus | `goals.md` |
| Notes, vault, Obsidian | `obsidian-dk-vault.md` |
| Email or calendar tasks | `email-and-calendar.md` |

When uncertain, prefer reading over skipping — a short irrelevant file is cheap; missing key context is costly.

### Step 3: Read relevant files

Use `Read` or `Bash cat` to load each relevant file. Limit to the files that are actually useful for this request — don't load everything by default.

### Step 4: Proceed with the answer

Incorporate the context naturally. No need to announce what was loaded unless it's directly referenced.
