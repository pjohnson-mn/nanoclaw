---
name: zen-quotes
description: Store Zen Buddhism quotes with citations and auto-tagging in the Obsidian vault.
allowed-tools: Bash(*)
---

# Zen Quotes Skill

Store Zen Buddhism quotes in the user's Obsidian vault with citations, manual and automatic tagging, and smart linking.

## Triggering

This skill is triggered in two ways:

1. **Keyword trigger**: Message starts with `[Zen]`, `zen:`, `zen -`, `zen quote:`, or similar variations indicating a Zen quote to store.
2. **Auto-detection**: The agent recognizes the message contains a Zen Buddhism quote, koan, dharma teaching, or Buddhist wisdom — even without an explicit prefix. Look for quotes attributed to Zen masters, Buddhist texts, or teachings with contemplative/dharmic themes.

## Instructions

### 1. Parse the quote

Extract the following from the user's message:

- **Quote text**: The actual quote or teaching
- **Attribution/Citation**: Author, teacher, text, or source (e.g., "Shunryu Suzuki", "Dogen", "Heart Sutra", "Zen Mind, Beginner's Mind")
- **Manual tags**: Any tags the user explicitly provides (e.g., "#impermanence #beginner-mind")
- **User commentary**: Any personal notes the user adds about the quote

If the citation is missing, try to identify it from your knowledge. If uncertain, leave the citation as "Unknown" — do not guess.

### 2. Auto-tag

Before assigning tags, scan existing vault notes for tags already in use:

```bash
grep -rh 'tags:' -A 10 /workspace/extra/dk-vault/Zen/ --include='*.md' 2>/dev/null | grep '^ *- ' | sort -u | head -30
```

Also scan vault-wide tags for broader context:

```bash
grep -rh 'tags:' -A 10 /workspace/extra/dk-vault/ --include='*.md' | grep '^ *- ' | sort -u | head -50
```

Generate 2-5 automatic tags based on the quote's themes. Common Zen/Buddhist tag categories:
- **Tradition/school**: zen, mahayana, theravada, chan, soto, rinzai
- **Concepts**: impermanence, emptiness, non-attachment, beginner-mind, mindfulness, suffering, compassion, interdependence, non-duality, satori, kensho, mu
- **Practice**: meditation, zazen, kinhin, koan, sesshin
- **Source type**: sutra, koan, dharma-talk, poem, teaching

Merge manual tags (from user) with auto-generated tags. Manual tags always take priority. Deduplicate.

### 3. Create the note

Save to `/workspace/extra/dk-vault/Zen/` (create the folder if it doesn't exist).

**Filename**: `YYYY-MM-DD <short-title>.md` where `<short-title>` is a concise 3-6 word summary. Use only valid filename characters.

Example: `2026-03-22 Beginner's Mind Shunryu Suzuki.md`

If a file with the same title exists for today, append to it under a new `---` separator rather than creating a duplicate.

**Note format**:

```markdown
---
date: YYYY-MM-DD
type: zen-quote
source: "<book, text, or talk title if known>"
teacher: "<attribution — person or tradition>"
tags:
  - zen
  - <tag1>
  - <tag2>
---

> <the quote, properly formatted as a blockquote>

— *<attribution>*

## Commentary

<user's personal notes if provided, otherwise omit this section>

## Context

<1-3 lines of context about the teacher, text, or teaching — drawn from your knowledge. Keep brief.>

## Related

<wikilinks to related notes>
```

### 4. Smart linking

Scan the vault for related notes:

```bash
# Check PKB for related concepts
ls /workspace/extra/dk-vault/PKB/ | head -50
# Check other Zen quotes
ls /workspace/extra/dk-vault/Zen/ 2>/dev/null
# Check Jots for related thoughts
ls /workspace/extra/dk-vault/Jots/ | head -30
# Search for thematically related content
grep -rl "<key concept from quote>" /workspace/extra/dk-vault/PKB/ /workspace/extra/dk-vault/Jots/ /workspace/extra/dk-vault/learning/ 2>/dev/null | head -10
```

Add `[[wikilinks]]` in the Related section for meaningful connections. Keep to 3-5 links max.

### 5. Git commit and push

After saving:

```bash
cd /workspace/extra/dk-vault
git add "Zen/"
git commit -m "zen: <short-title>"
ENCODED_USER=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$GITEA_USER', safe=''))") && git -C /workspace/extra/dk-vault -c "url.https://$ENCODED_USER:$GITEA_TOKEN@g.i.pupaya.net/.insteadOf=https://g.i.pupaya.net/" push
```

### 6. Confirm to user

Send a brief confirmation via `mcp__nanoclaw__send_message`:

- Quote title and attribution
- Tags applied (both manual and auto)
- Any related notes linked
- Keep to 3-4 lines max

Example:
```
Saved: "In the beginner's mind there are many possibilities" — Shunryu Suzuki
Tags: zen, beginner-mind, openness, soto
Linked to: [[Beginner's Mind]], [[Meditation Practice]]
```

## Important

- Don't ask clarifying questions. Capture what was given.
- Clean up typos in the quote but preserve the original wording faithfully.
- If the user provides multiple quotes in one message, create separate notes for each.
- The Related section can be empty if nothing relevant is found.
- Always include the `zen` tag.
- Preserve the exact quote — do not paraphrase or alter the meaning.
