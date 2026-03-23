---
name: embed-notes
description: Embed Obsidian vault notes into Qdrant for semantic search. Use when user asks to index, sync, or rebuild the v_obsidian_notes vector collection, or to search notes semantically. Covers TaskNotes, meetings, 1-1s, people, daily notes, Jots, learning, AI summaries, and PKB.
allowed-tools: Bash(*)
vars:
  - OPENAI_API_KEY
  - QDRANT_URL
---

# Embed Notes Skill

Scans multiple folders in the Obsidian vault, generates OpenAI embeddings for each note (using a markdown-aware chunking strategy), and upserts them into the Qdrant collection `v_obsidian_notes`. Supports incremental sync — only re-embeds notes whose file modification time has changed since last indexed.

## Vault path

All notes live under `/workspace/extra/dk-vault/`.

---

## Folders Indexed

| Folder | `folder_type` value | Notes |
|--------|--------------------|----|
| `TaskNotes/Tasks/` | `task` | Task and project notes (TaskNotes plugin) |
| `TaskNotes/Updates/` | `task_update` | Update notes linked to tasks |
| `_ai_note_summaries/_ai_summary_1-1s/` | `ai_summary` | AI-generated 1-1 summaries |
| `_ai_note_summaries/_aisummary_meetings/` | `ai_summary` | AI-generated meeting summaries |
| `@people/` | `person` | Contact/CRM notes (prefixed `@Name.md`) |
| `1-1s/` | `one_on_one` | 1-on-1 meeting notes (per-person subfolders) |
| `Daily Notes/` | `daily` | Daily journal notes (`YYYY-MM-DD.md`) — also referred to as "Daily Nytes" |
| `Jots/` | `jot` | Quick-capture brainstorm notes |
| `learning/` | `learning` | Course/talk/article notes |
| `meetings/` | `meeting` | General meeting notes |
| `PKB/` | `pkb` | Personal knowledge base (recursive, multiple subfolders) |

---

## Metadata Schema

All Qdrant points share these base payload fields:

| Field | Source | Notes |
|-------|--------|-------|
| `note_name` | filename (no ext) | e.g., `Fix login bug` |
| `file_path` | relative vault path | e.g., `meetings/2026-02-24 QBR.md` |
| `folder_type` | derived from path | see table above |
| `last_modified` | `os.path.getmtime()` | float epoch — used for incremental sync |
| `tags` | frontmatter `tags` | array of strings |
| `body_text` | note body (after frontmatter) | truncated to 4000 chars for storage |
| `embed_text_preview` | computed | first 300 chars of what was embedded |
| `chunk_index` | int | 0-based chunk number within this note |
| `total_chunks` | int | total chunks for this note |
| `chunk_heading` | str or null | H2 heading for this chunk, if split |

### Per-folder additional fields

**`task` / `task_update`:**

| Field | Frontmatter Key |
|-------|----------------|
| `note_type` | `type` (task / update) |
| `title` | `title` |
| `status` | `status` |
| `priority` | `priority` |
| `scheduled` | `scheduled` |
| `date_created` | `dateCreated` |
| `date_modified_fm` | `dateModified` (frontmatter; separate from file mtime) |
| `assigned_to` | `assignedTo` (wikilinks stripped) |
| `stakeholders` | `stakeholders` (wikilinks stripped) |
| `is_project` | derived: true if type/tags contain "project" |
| `related_project` | `related_project` (wikilinks stripped) |
| `contexts` | tags starting with `@` |

**`ai_summary`:**

| Field | Derived |
|-------|---------|
| `summary_date` | extracted from filename (`YYYY-MM-DD` prefix) |
| `summary_subtype` | `1-1` or `meeting` (from subfolder) |
| `action_items` | lines containing `[ ]` checkbox text, joined |

**`person`:**

| Field | Derived |
|-------|---------|
| `person_name` | filename with leading `@` stripped, no ext |

**`one_on_one`:**

| Field | Frontmatter Key |
|-------|----------------|
| `note_type` | `type` |
| `create_date` | `createDate` |
| `people` | `people` (wikilinks stripped) |
| `person_folder` | parent subfolder name (e.g., `Rudy`) |
| `event_id` | `eventId` |

**`daily`:**

| Field | Frontmatter Key |
|-------|----------------|
| `note_date` | `date` or extracted from filename |
| `note_type` | `type` |

**`jot`:**

| Field | Frontmatter Key |
|-------|----------------|
| `note_date` | `date` |
| `tags` | `tags` |

**`learning`:**

| Field | Frontmatter Key |
|-------|----------------|
| `note_type` | `type` |
| `create_date` | `createDate` |
| `source_url` | `url` |

**`meeting`:**

| Field | Frontmatter Key |
|-------|----------------|
| `note_type` | `type` |
| `create_date` | `createDate` |
| `people` | `people` (wikilinks stripped) |
| `related_project` | `related_project` (wikilinks stripped) |

**`pkb`:**

| Field | Derived |
|-------|---------|
| `pkb_category` | immediate subfolder name (e.g., `AI-Tech`, `DK-Domain`) |

---

## Chunking Strategy

Markdown files are split by **H2 headings** when long; short notes are kept as a single chunk.

Rules:
1. Strip frontmatter first; work only on the body.
2. If body length ≤ 1800 characters → **single chunk** (chunk_index=0, total_chunks=1, chunk_heading=null).
3. Otherwise, split on `\n## ` boundaries. Each chunk contains:
   - The H1 title line (if present) prepended for context
   - The H2 heading line itself
   - All content until the next H2
4. Chunks shorter than 100 chars after stripping are merged with the previous chunk.
5. Maximum chunk size is 4000 characters (split further at paragraph boundaries if needed).

### Embed text construction

Each chunk's `embed_text` is built as:

```
[{folder_type}] {note_name}
Type: {note_type_or_folder}  Date: {date_if_any}  Tags: {tags_joined}
People: {people_if_any}  Status: {status_if_any}  Priority: {priority_if_any}

## {chunk_heading_if_any}
{chunk_content}
```

This ensures the embedding captures both semantic content and metadata context, improving recall for queries like "what did I discuss with Rudy about roadmap?" or "high-priority tasks related to AI platform".

---

## Instructions

### Step 0 — Pull latest vault changes

```bash
git -C /workspace/extra/dk-vault pull --ff-only 2>&1 | tail -3
```

If the pull fails (e.g. conflict, no network), log the error and continue — embed whatever is on disk rather than aborting.

---

### Step 1 — Ensure collection exists

```bash
curl -s -X GET "$(printenv QDRANT_URL)/collections/v_obsidian_notes"
```

If the collection does not exist (result.status != "ok"), create it:

```bash
cat > /tmp/qdrant_create.json <<'ENDJSON'
{
  "vectors": {
    "size": 1536,
    "distance": "Cosine"
  }
}
ENDJSON

curl -s -X PUT "$(printenv QDRANT_URL)/collections/v_obsidian_notes" \
  -H "Content-Type: application/json" \
  -d @/tmp/qdrant_create.json
```

---

### Step 2 — Parse all vault notes

Write the parser script to `/tmp/parse_notes.py` and run it:

```bash
python3 /tmp/parse_notes.py
```

The script content to write to `/tmp/parse_notes.py`:

```python
import os, json, re, time

VAULT = "/workspace/extra/dk-vault"
OUTPUT = "/tmp/notes_parsed.json"

# Folders to scan: (relative_path, folder_type, recursive)
SCAN_DIRS = [
    ("TaskNotes/Tasks",                            "task",        False),
    ("TaskNotes/Updates",                          "task_update", False),
    ("_ai_note_summaries/_ai_summary_1-1s",        "ai_summary",  False),
    ("_ai_note_summaries/_aisummary_meetings",     "ai_summary",  False),
    ("@people",                                    "person",      False),
    ("1-1s",                                       "one_on_one",  True),
    ("Daily Notes",                                "daily",       False),
    ("Jots",                                       "jot",         False),
    ("learning",                                   "learning",    False),
    ("meetings",                                   "meeting",     False),
    ("PKB",                                        "pkb",         True),
]

# ── Helpers ────────────────────────────────────────────────────────────────

def parse_frontmatter(content):
    fm, body = {}, content
    if content.startswith("---"):
        end = content.find("---", 3)
        if end != -1:
            yaml_block = content[3:end].strip()
            body = content[end+3:].strip()
            current_key = None
            current_list = None
            for line in yaml_block.splitlines():
                list_item = re.match(r'^  - (.+)', line)
                kv = re.match(r'^([\w][\w\s-]*?)\s*:\s*(.*)', line)
                if list_item and current_key:
                    val = list_item.group(1).strip().strip('"\'')
                    if current_list is None:
                        current_list = []
                        fm[current_key] = current_list
                    current_list.append(val)
                elif kv:
                    current_key = kv.group(1).strip()
                    current_list = None
                    val = kv.group(2).strip().strip('"\'')
                    fm[current_key] = val if val else None
    return fm, body

def strip_wikilinks(value):
    if value is None:
        return None
    if isinstance(value, list):
        return [re.sub(r'\[\[(.+?)\]\]', r'\1', v).strip() for v in value]
    return re.sub(r'\[\[(.+?)\]\]', r'\1', str(value)).strip()

def ensure_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]

def extract_date_from_filename(fname):
    m = re.match(r'^(\d{4}-\d{2}-\d{2})', fname)
    return m.group(1) if m else None

def extract_action_items(body):
    items = re.findall(r'\[ \]\s*(.+)', body)
    return " | ".join(items[:10]) if items else None

# ── Chunking ───────────────────────────────────────────────────────────────

MAX_SINGLE_CHUNK = 1800
MAX_CHUNK_SIZE   = 4000
MIN_CHUNK_SIZE   = 100

def chunk_markdown(body):
    """Split by H2 headings for long notes; single chunk for short."""
    if len(body) <= MAX_SINGLE_CHUNK:
        return [{"chunk_index": 0, "total_chunks": 1, "chunk_heading": None, "content": body}]

    # Extract H1 title for context prefix
    h1_match = re.search(r'^# (.+)$', body, re.MULTILINE)
    h1_line = (h1_match.group(0) + "\n") if h1_match else ""

    # Split on H2 boundaries
    raw_sections = re.split(r'(?=\n## )', body)
    sections = [s.strip() for s in raw_sections if s.strip()]

    if len(sections) <= 1:
        return _split_by_paragraphs(body)

    chunks = []
    for section in sections:
        h2_match = re.match(r'^## (.+)', section)
        heading = h2_match.group(1) if h2_match else None
        content_block = (h1_line + section).strip() if heading else section.strip()

        # Merge tiny sections with previous chunk
        if len(content_block) < MIN_CHUNK_SIZE and chunks:
            chunks[-1]["content"] += "\n" + content_block
            continue

        # Split oversized sections at paragraphs
        if len(content_block) > MAX_CHUNK_SIZE:
            sub = _split_by_paragraphs(content_block)
            for i, s in enumerate(sub):
                s["chunk_heading"] = (heading + f" (part {i+1})") if heading else None
            chunks.extend(sub)
        else:
            chunks.append({"chunk_heading": heading, "content": content_block})

    if not chunks:
        return [{"chunk_index": 0, "total_chunks": 1, "chunk_heading": None, "content": body}]

    total = len(chunks)
    for i, c in enumerate(chunks):
        c["chunk_index"] = i
        c["total_chunks"] = total
    return chunks

def _split_by_paragraphs(body):
    paragraphs = re.split(r'\n{2,}', body)
    chunks, current = [], ""
    for para in paragraphs:
        if len(current) + len(para) + 2 > MAX_CHUNK_SIZE and current:
            chunks.append({"chunk_heading": None, "content": current.strip()})
            current = para
        else:
            current = (current + "\n\n" + para).strip() if current else para
    if current.strip():
        chunks.append({"chunk_heading": None, "content": current.strip()})
    if not chunks:
        chunks = [{"chunk_heading": None, "content": body}]
    total = len(chunks)
    for i, c in enumerate(chunks):
        c["chunk_index"] = i
        c["total_chunks"] = total
    return chunks

# ── Embed text builder ─────────────────────────────────────────────────────

def build_embed_text(base, chunk):
    parts = []
    folder_type = base.get("folder_type", "")
    note_name   = base.get("note_name", "")
    parts.append(f"[{folder_type}] {note_name}")

    meta = []
    for key in ("note_type", "create_date", "note_date", "summary_date"):
        if base.get(key):
            meta.append(f"{key.replace('_', ' ').title()}: {base[key]}")
    tags = base.get("tags") or []
    if tags:
        meta.append("Tags: " + " ".join(tags))
    for key in ("people", "assigned_to", "stakeholders", "person_name", "person_folder"):
        val = base.get(key)
        if val:
            if isinstance(val, list):
                val = ", ".join(v for v in val if v)
            if val:
                meta.append(f"{key.replace('_', ' ').title()}: {val}")
    for key in ("status", "priority", "pkb_category", "source_url"):
        if base.get(key):
            meta.append(f"{key.replace('_', ' ').title()}: {base[key]}")
    if meta:
        parts.append("  ".join(meta))

    if chunk.get("chunk_heading"):
        parts.append(f"\n## {chunk['chunk_heading']}")
    parts.append(chunk["content"])

    return "\n".join(parts)[:8000]

# ── Per-folder metadata extractors ────────────────────────────────────────

def meta_task(fm, body, fpath, folder_type):
    tags = ensure_list(fm.get("tags"))
    note_type = fm.get("type", "task")
    is_project = (
        "project" in str(note_type).lower()
        or any("project" in str(t).lower() for t in tags)
    )
    return {
        "note_type":        note_type,
        "title":            fm.get("title"),
        "status":           fm.get("status"),
        "priority":         fm.get("priority"),
        "scheduled":        fm.get("scheduled"),
        "date_created":     fm.get("dateCreated"),
        "date_modified_fm": fm.get("dateModified"),
        "assigned_to":      strip_wikilinks(fm.get("assignedTo")),
        "stakeholders":     strip_wikilinks(ensure_list(fm.get("stakeholders"))),
        "is_project":       is_project,
        "related_project":  strip_wikilinks(fm.get("related_project")),
        "contexts":         [t for t in tags if t.startswith("@")],
        "tags":             tags,
    }

def meta_ai_summary(fm, body, fpath, folder_type):
    fname = os.path.basename(fpath)
    subtype = "1-1" if "_ai_summary_1-1s" in fpath else "meeting"
    return {
        "summary_date":    extract_date_from_filename(fname),
        "summary_subtype": subtype,
        "action_items":    extract_action_items(body),
        "tags":            [],
    }

def meta_person(fm, body, fpath, folder_type):
    fname = os.path.splitext(os.path.basename(fpath))[0]
    return {
        "person_name": fname.lstrip("@"),
        "tags":        ensure_list(fm.get("tags")),
    }

def meta_one_on_one(fm, body, fpath, folder_type):
    person_folder = os.path.basename(os.path.dirname(fpath))
    # Don't use the top-level "1-1s" folder name as person
    if person_folder == "1-1s":
        person_folder = None
    return {
        "note_type":     fm.get("type", "1-1"),
        "create_date":   fm.get("createDate"),
        "people":        strip_wikilinks(ensure_list(fm.get("people"))),
        "person_folder": person_folder,
        "event_id":      fm.get("eventId"),
        "tags":          ensure_list(fm.get("tags")),
    }

def meta_daily(fm, body, fpath, folder_type):
    fname = os.path.splitext(os.path.basename(fpath))[0]
    return {
        "note_date": fm.get("date") or extract_date_from_filename(fname),
        "note_type": fm.get("type", "daily"),
        "tags":      ensure_list(fm.get("tags")),
    }

def meta_jot(fm, body, fpath, folder_type):
    fname = os.path.splitext(os.path.basename(fpath))[0]
    return {
        "note_date": str(fm.get("date") or "") or extract_date_from_filename(fname),
        "tags":      ensure_list(fm.get("tags")),
    }

def meta_learning(fm, body, fpath, folder_type):
    return {
        "note_type":  fm.get("type", "learning"),
        "create_date":fm.get("createDate"),
        "source_url": fm.get("url"),
        "tags":       ensure_list(fm.get("tags")),
    }

def meta_meeting(fm, body, fpath, folder_type):
    return {
        "note_type":       fm.get("type", "meeting"),
        "create_date":     fm.get("createDate"),
        "people":          strip_wikilinks(ensure_list(fm.get("people"))),
        "related_project": strip_wikilinks(fm.get("related_project")),
        "tags":            ensure_list(fm.get("tags")),
    }

def meta_pkb(fm, body, fpath, folder_type):
    # Immediate subfolder under PKB/
    rel = os.path.relpath(fpath, os.path.join(VAULT, "PKB"))
    parts = rel.split(os.sep)
    category = parts[0] if len(parts) > 1 else ""
    return {
        "pkb_category": category,
        "tags":         ensure_list(fm.get("tags")),
    }

META_EXTRACTORS = {
    "task":        meta_task,
    "task_update": meta_task,
    "ai_summary":  meta_ai_summary,
    "person":      meta_person,
    "one_on_one":  meta_one_on_one,
    "daily":       meta_daily,
    "jot":         meta_jot,
    "learning":    meta_learning,
    "meeting":     meta_meeting,
    "pkb":         meta_pkb,
}

# ── File walker ────────────────────────────────────────────────────────────

def walk_files(rel_dir, recursive):
    abs_dir = os.path.join(VAULT, rel_dir)
    if not os.path.isdir(abs_dir):
        print(f"  SKIP (not found): {abs_dir}")
        return
    if recursive:
        for root, dirs, files in os.walk(abs_dir):
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d != '_attachments')
            for fname in sorted(files):
                if fname.endswith(".md") and not fname.startswith('.'):
                    yield os.path.join(root, fname)
    else:
        for fname in sorted(os.listdir(abs_dir)):
            if fname.endswith(".md") and not fname.startswith('.'):
                yield os.path.join(abs_dir, fname)

# ── Main ───────────────────────────────────────────────────────────────────

records = []
folder_counts = {}

for rel_dir, folder_type, recursive in SCAN_DIRS:
    count = 0
    for fpath in walk_files(rel_dir, recursive):
        try:
            with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except Exception as e:
            print(f"  ERROR reading {fpath}: {e}")
            continue

        fname     = os.path.basename(fpath)
        note_name = os.path.splitext(fname)[0]
        rel_path  = os.path.relpath(fpath, VAULT)
        mtime     = os.path.getmtime(fpath)

        fm, body = parse_frontmatter(content)

        extractor  = META_EXTRACTORS.get(folder_type, lambda *a: {"tags": []})
        extra_meta = extractor(fm, body, fpath, folder_type)

        base = {
            "note_name":    note_name,
            "file_path":    rel_path,
            "folder_type":  folder_type,
            "last_modified": mtime,
            "body_text":    body[:4000],
        }
        base.update(extra_meta)

        chunks = chunk_markdown(body)
        for chunk in chunks:
            record = dict(base)
            record["chunk_index"]   = chunk["chunk_index"]
            record["total_chunks"]  = chunk["total_chunks"]
            record["chunk_heading"] = chunk.get("chunk_heading")
            record["embed_text"]    = build_embed_text(base, chunk)
            records.append(record)
        count += 1

    folder_counts[folder_type] = folder_counts.get(folder_type, 0) + count
    print(f"  {folder_type:12s} ({rel_dir}): {count} files")

with open(OUTPUT, "w") as f:
    json.dump(records, f, indent=2)
print(f"\nParsed {len(records)} chunks from {sum(folder_counts.values())} notes → {OUTPUT}")
```

---

### Step 3 — Incremental sync check

Compare `last_modified` against what is stored in Qdrant to skip unchanged notes.

```bash
python3 - <<'EOF'
import json, subprocess, os

with open("/tmp/notes_parsed.json") as f:
    records = json.load(f)

# Scroll all existing points — fetch file_path + last_modified + chunk_index
result = subprocess.run([
    "curl", "-s", "-X", "POST",
    f"{os.environ['QDRANT_URL']}/collections/v_obsidian_notes/points/scroll",
    "-H", "Content-Type: application/json",
    "-d", json.dumps({
        "limit": 10000,
        "with_payload": ["file_path", "last_modified", "chunk_index"],
        "with_vector": False
    })
], capture_output=True, text=True)

resp = json.loads(result.stdout)
# Key: (file_path, chunk_index) → last_modified
existing = {}
for pt in resp.get("result", {}).get("points", []):
    p = pt["payload"]
    fp = p.get("file_path")
    ci = p.get("chunk_index", 0)
    lm = p.get("last_modified")
    if fp is not None:
        existing[(fp, ci)] = lm

to_embed = []
for r in records:
    key = (r["file_path"], r["chunk_index"])
    stored_mtime = existing.get(key)
    if stored_mtime is None or abs(float(stored_mtime) - float(r["last_modified"])) > 1.0:
        to_embed.append(r)

with open("/tmp/notes_to_embed.json", "w") as f:
    json.dump(to_embed, f, indent=2)
print(f"{len(to_embed)} chunks to embed (out of {len(records)} total)")
EOF
```

---

### Step 4 — Generate embeddings and upsert (batched)

```bash
python3 - <<'EOF'
import json, subprocess, os, hashlib

with open("/tmp/notes_to_embed.json") as f:
    records = json.load(f)

OPENAI_KEY = os.environ["OPENAI_API_KEY"]
QDRANT_URL = os.environ["QDRANT_URL"]
BATCH_SIZE = 20

def point_id(file_path, chunk_index):
    """Deterministic numeric ID from (file_path, chunk_index)."""
    key = f"{file_path}::chunk::{chunk_index}"
    return int(hashlib.sha256(key.encode()).hexdigest()[:15], 16)

def get_embeddings(texts):
    payload = json.dumps({"model": "text-embedding-3-small", "input": texts})
    with open("/tmp/embed_batch.json", "w") as f:
        f.write(payload)
    result = subprocess.run([
        "curl", "-s", "-X", "POST", "https://api.openai.com/v1/embeddings",
        "-H", f"Authorization: Bearer {OPENAI_KEY}",
        "-H", "Content-Type: application/json",
        "-d", "@/tmp/embed_batch.json"
    ], capture_output=True, text=True)
    resp = json.loads(result.stdout)
    if "data" not in resp:
        print(f"  Embedding error: {resp}")
        return None
    return [d["embedding"] for d in resp["data"]]

total_upserted = 0
errors = 0

for i in range(0, len(records), BATCH_SIZE):
    batch = records[i:i+BATCH_SIZE]
    texts = [r["embed_text"] for r in batch]
    vectors = get_embeddings(texts)
    if vectors is None:
        errors += len(batch)
        continue

    points = []
    for record, vec in zip(batch, vectors):
        payload = {k: v for k, v in record.items() if k != "embed_text"}
        payload["embed_text_preview"] = record["embed_text"][:300]
        points.append({
            "id":      point_id(record["file_path"], record["chunk_index"]),
            "vector":  vec,
            "payload": payload
        })

    upsert = json.dumps({"points": points})
    with open("/tmp/qdrant_upsert.json", "w") as f:
        f.write(upsert)
    result = subprocess.run([
        "curl", "-s", "-X", "PUT",
        f"{QDRANT_URL}/collections/v_obsidian_notes/points",
        "-H", "Content-Type: application/json",
        "-d", "@/tmp/qdrant_upsert.json"
    ], capture_output=True, text=True)
    resp = json.loads(result.stdout)
    status = resp.get("result", {}).get("status", "unknown")
    total_upserted += len(batch)
    print(f"Batch {i//BATCH_SIZE + 1}: {len(batch)} chunks — status: {status}")

print(f"\nDone. {total_upserted} chunks embedded. {errors} errors.")
EOF
```

---

### Step 5 — Report to user

After indexing, report:
- Total chunks scanned vs newly embedded
- Breakdown by `folder_type` (file count)
- Any errors
- Collection name

Example:
```
Notes indexed
- 312 chunks scanned across all folders
- 47 newly embedded (new or changed)
- 265 skipped (unchanged)
- Collection: v_obsidian_notes

Breakdown:
  task          42 files
  meeting       31 files
  daily         28 files
  pkb           19 files
  one_on_one    18 files
  ai_summary    14 files
  person        40 files
  learning       3 files
  jot            7 files
  task_update    6 files
```

---

---

## Cron / Recent-only Mode

When running on a schedule (every 15 minutes), use this fast path instead of Steps 2–4 above. It limits the file scan to notes modified in the last N minutes, avoiding a full vault walk.

### Step 0R — Pull latest vault changes

```bash
git -C /workspace/extra/dk-vault pull --ff-only 2>&1 | tail -3
```

If the pull fails, log and continue with whatever is on disk.

---

### Step 2R — Find recently modified files

```bash
MINUTES=20  # slight buffer over the 15-min cron interval
find /workspace/extra/dk-vault/TaskNotes/Tasks \
     /workspace/extra/dk-vault/TaskNotes/Updates \
     /workspace/extra/dk-vault/_ai_note_summaries \
     /workspace/extra/dk-vault/@people \
     /workspace/extra/dk-vault/1-1s \
     "/workspace/extra/dk-vault/Daily Notes" \
     /workspace/extra/dk-vault/Jots \
     /workspace/extra/dk-vault/learning \
     /workspace/extra/dk-vault/meetings \
     /workspace/extra/dk-vault/PKB \
     -name "*.md" -not -name ".*" -newer /tmp/embed_notes_last_run \
     2>/dev/null | sort > /tmp/recent_files.txt

# On first run (no sentinel), fall back to -mmin
if [ ! -s /tmp/recent_files.txt ]; then
  find /workspace/extra/dk-vault/TaskNotes/Tasks \
       /workspace/extra/dk-vault/TaskNotes/Updates \
       /workspace/extra/dk-vault/_ai_note_summaries \
       /workspace/extra/dk-vault/@people \
       /workspace/extra/dk-vault/1-1s \
       "/workspace/extra/dk-vault/Daily Notes" \
       /workspace/extra/dk-vault/Jots \
       /workspace/extra/dk-vault/learning \
       /workspace/extra/dk-vault/meetings \
       /workspace/extra/dk-vault/PKB \
       -name "*.md" -not -name ".*" -mmin -$MINUTES \
       2>/dev/null | sort > /tmp/recent_files.txt
fi

wc -l /tmp/recent_files.txt
```

If `/tmp/recent_files.txt` is empty (0 lines), **stop here** — no new/changed notes. Report: "No vault changes in the last 15 minutes."

Otherwise, update the sentinel and continue:
```bash
touch /tmp/embed_notes_last_run
```

### Step 3R — Parse only recent files

Write and run `/tmp/parse_recent_notes.py`:

```python
import os, json, re, sys

# Reuse all helpers from the full parser (parse_frontmatter, strip_wikilinks,
# ensure_list, extract_date_from_filename, extract_action_items,
# chunk_markdown, _split_by_paragraphs, build_embed_text,
# all meta_* extractors, META_EXTRACTORS dict) — copy them verbatim here.

VAULT = "/workspace/extra/dk-vault"
OUTPUT = "/tmp/notes_parsed.json"

# Map vault subdirs to folder_type
FOLDER_TYPE_MAP = [
    ("TaskNotes/Tasks",                          "task"),
    ("TaskNotes/Updates",                        "task_update"),
    ("_ai_note_summaries/_ai_summary_1-1s",      "ai_summary"),
    ("_ai_note_summaries/_aisummary_meetings",   "ai_summary"),
    ("_ai_note_summaries",                       "ai_summary"),
    ("@people",                                  "person"),
    ("1-1s",                                     "one_on_one"),
    ("Daily Notes",                              "daily"),
    ("Jots",                                     "jot"),
    ("learning",                                 "learning"),
    ("meetings",                                 "meeting"),
    ("PKB",                                      "pkb"),
]

def infer_folder_type(fpath):
    rel = os.path.relpath(fpath, VAULT)
    for prefix, ftype in FOLDER_TYPE_MAP:
        if rel.startswith(prefix.replace("/", os.sep)):
            return ftype
    return "unknown"

with open("/tmp/recent_files.txt") as f:
    file_list = [l.strip() for l in f if l.strip() and l.strip().endswith(".md")]

# --- paste all helpers from parse_notes.py here ---
# (parse_frontmatter, strip_wikilinks, ensure_list, extract_date_from_filename,
#  extract_action_items, chunk_markdown, _split_by_paragraphs, build_embed_text,
#  meta_task, meta_ai_summary, meta_person, meta_one_on_one, meta_daily,
#  meta_jot, meta_learning, meta_meeting, meta_pkb, META_EXTRACTORS)

records = []
for fpath in file_list:
    if not os.path.isfile(fpath):
        continue
    try:
        with open(fpath, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        print(f"  ERROR: {fpath}: {e}")
        continue

    fname     = os.path.basename(fpath)
    note_name = os.path.splitext(fname)[0]
    rel_path  = os.path.relpath(fpath, VAULT)
    mtime     = os.path.getmtime(fpath)
    folder_type = infer_folder_type(fpath)

    fm, body = parse_frontmatter(content)
    extractor  = META_EXTRACTORS.get(folder_type, lambda *a: {"tags": []})
    extra_meta = extractor(fm, body, fpath, folder_type)

    base = {
        "note_name":    note_name,
        "file_path":    rel_path,
        "folder_type":  folder_type,
        "last_modified": mtime,
        "body_text":    body[:4000],
    }
    base.update(extra_meta)

    for chunk in chunk_markdown(body):
        record = dict(base)
        record["chunk_index"]   = chunk["chunk_index"]
        record["total_chunks"]  = chunk["total_chunks"]
        record["chunk_heading"] = chunk.get("chunk_heading")
        record["embed_text"]    = build_embed_text(base, chunk)
        records.append(record)

with open(OUTPUT, "w") as f:
    json.dump(records, f, indent=2)
print(f"Parsed {len(records)} chunks from {len(file_list)} recent files")
```

Then skip the Qdrant incremental check (Step 3) since all files in the list are already known to be new/changed — go straight to **Step 4** (embed and upsert).

### Reporting for cron runs

Keep it terse — only report if there were actual changes:
```
Vault sync: 3 notes updated (meeting, daily, jot) — 7 chunks embedded.
```
If nothing changed, send nothing (no message to user).

---

## Triggering

Triggered when the user asks to:
- Index or embed notes / vault notes
- Sync notes to Qdrant / `v_obsidian_notes`
- Rebuild the notes vector index
- Index specific folders (meetings, PKB, daily notes, etc.)
- Search notes or vault content semantically (first ensure collection is populated)
- "Daily Nytes" or "Daily Notes" — both refer to the same `Daily Notes/` folder

---

## Semantic Search (ad-hoc use)

```bash
QUERY_VECTOR=$(curl -s -X POST "https://api.openai.com/v1/embeddings" \
  -H "Authorization: Bearer $(printenv OPENAI_API_KEY)" \
  -H "Content-Type: application/json" \
  -d '{"model": "text-embedding-3-small", "input": "USER QUERY HERE"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['embedding'])")

cat > /tmp/qdrant_search.json <<ENDJSON
{
  "query": $QUERY_VECTOR,
  "limit": 5,
  "with_payload": true,
  "score_threshold": 0.3
}
ENDJSON

curl -s -X POST "$(printenv QDRANT_URL)/collections/v_obsidian_notes/points/query" \
  -H "Content-Type: application/json" \
  -d @/tmp/qdrant_search.json
```

### Filtered search examples

By folder type:
```json
{"filter": {"must": [{"key": "folder_type", "match": {"any": ["meeting", "one_on_one"]}}]}}
```

By person (meetings/1-1s with a specific person):
```json
{"filter": {"must": [{"key": "people", "match": {"any": ["Rudy"]}}]}}
```

Active tasks only:
```json
{"filter": {"must": [{"key": "status", "match": {"value": "in-progress"}}]}}
```

High-priority tasks:
```json
{"filter": {"must": [{"key": "priority", "match": {"value": "high"}}]}}
```

PKB by category:
```json
{"filter": {"must": [{"key": "pkb_category", "match": {"value": "AI-Tech"}}]}}
```

Daily notes date range:
```json
{"filter": {"must": [
  {"key": "folder_type", "match": {"value": "daily"}},
  {"key": "note_date", "range": {"gte": "2026-01-01", "lte": "2026-03-31"}}
]}}
```

1-1s by person folder:
```json
{"filter": {"must": [{"key": "person_folder", "match": {"value": "Rudy"}}]}}
```

---

## Guidelines

1. **Incremental sync** — compare `last_modified` (file mtime) before re-embedding. When a file changes, all its chunks are re-embedded (they share the same mtime, so any change re-processes the whole file).
2. **Deterministic IDs** — `sha256(file_path::chunk::N)` ensures upserts are idempotent.
3. **Chunk-aware IDs** — each chunk of a multi-chunk note gets its own Qdrant point with its own ID.
4. **Metadata-enriched embed text** — prefix each chunk with folder type, note name, date, people, and tags so the vector captures both semantic content and structural context.
5. **Batch embeddings** — up to 20 chunks per OpenAI API call.
6. **score_threshold 0.3** — sensible default; raise to 0.5+ for stricter matching.
7. **"Daily Nytes"** — user may refer to Daily Notes as "Daily Nytes"; both map to `Daily Notes/` folder.
8. **_attachments skipped** — image/attachment subfolders are excluded during recursive walks.
