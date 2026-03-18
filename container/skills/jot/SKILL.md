---
name: jot
description: Quickly capture a fleeting thought to the Jots folder in the Obsidian vault with smart linking and tags.
allowed-tools: Bash(*)
---

# Jot Skill

Capture fleeting thoughts instantly into the user's Obsidian vault. Speed is the priority — save first, enrich after.

## Triggering

This skill is triggered when a message starts with `[Jot]`. The text after `[Jot]` is the thought to capture.

## Instructions

When a jot arrives, do the following:

### 1. Capture immediately

- Create a new markdown file in the `Jots/` folder of the vault (at `/workspace/extra/dk-vault/Jots/`).
- Filename: `YYYY-MM-DD <short-title>.md` where `<short-title>` is a concise 3-6 word summary derived from the thought. Use only valid filename characters. Example: `2026-03-18 token bucket rate limiter.md`
- If a jot with the same title already exists for today, append to it rather than creating a duplicate.

### 2. Note format

```markdown
---
date: YYYY-MM-DD
tags:
  - <tag1>
  - <tag2>
---

<the thought, cleaned up slightly for clarity but preserving the original intent>

## Context

<any relevant connections — brief, 1-3 lines max>

## Related

<wikilinks to related notes>
```

### 3. Tags — reuse existing

Before assigning tags, scan existing vault notes for tags already in use:

```bash
grep -rh '^  - ' /workspace/extra/dk-vault/ --include='*.md' | grep '^ *- #\|^ *- [a-z]' | sort -u | head -50
```

Also check frontmatter tags:

```bash
grep -rh 'tags:' -A 10 /workspace/extra/dk-vault/ --include='*.md' | grep '^ *- ' | sort -u | head -50
```

Reuse existing tags when they fit. Only create a new tag if nothing existing is relevant. Aim for 2-4 tags per jot.

### 4. Smart linking

Scan the vault for related notes:

- Search PKB entries, daily notes, meeting notes, and other jots for overlapping concepts.
- Add `[[wikilinks]]` in the Related section for any notes with meaningful connections.
- If the thought relates to a topic in the PKB, link to it.
- If it connects to recent daily notes or meetings, link those too.
- Keep it to 3-5 links max — only genuinely relevant connections.

### 5. Git commit and push

After saving the jot, immediately commit and push:

- Follow the git instructions in `obsidian-dk-vault.md` context for push commands.
- Commit message: `jot: <short-title>`

### 6. Confirm to user

Send a brief confirmation via `mcp__nanoclaw__send_message`:

- Confirm the jot was saved
- List any related notes that were linked (just the note names, not full paths)
- Keep it to 2-3 lines max

Example confirmation:
```
Jotted: "token bucket rate limiter"
Linked to: [[Rate Limiting]], [[API Gateway Architecture]]
```

## Important

- Speed over perfection. Get the thought saved first, then enrich.
- Don't ask clarifying questions. Just capture what was given.
- Clean up typos and grammar slightly, but don't rewrite the thought.
- The Related section can be empty if nothing relevant is found — that's fine.
