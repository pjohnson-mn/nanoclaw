---
name: get-plaud-recording
description: Fetches recent Plaud AI recordings from the timefarm specified by the user (default to last 120 minutes), extracts auto-summary notes, writes them to the Obsidian _ai_summaries folder, and links them to the most semantically similar meeting note. Use this skill whenever the user asks to sync Plaud recordings, ingest Plaud notes, pull in recent recordings, or process Plaud summaries into Obsidian.
---

# Get Plaud AI Recording Skill

Fetches recent Plaud recordings, extracts AI-generated summaries, writes them to the Obsidian vault, and creates backlinks from the most similar existing meeting note.

---

## Dependencies

- `PLAUD_TOKEN` environment variable must be set (Bearer token for Plaud API)
- Obsidian vault at `~/dk-vault`
- Qdrant skill for semantic search — see `references/qdrant-skill-path.md`
- `python3` with `requests` available

---

## Step-by-step Workflow

### 1. Fetch Recent Recordings

Call the Plaud list endpoint:

```
GET https://platform.plaud.ai/developer/api/open/third-party/files/?page_size=20
Authorization: Bearer !`echo $PLAUD_TOKEN`
```

Filter records where `start_at` is within the **last 120 minutes** of the current UTC time.

**Timestamp handling:**
- `start_at` format: `"2024-01-15T10:04:27.052000"` — treat as UTC, no timezone suffix
- Compare against `datetime.utcnow()` with a 120-minute window
- If `start_at` is missing or null on a record, skip it

**Pagination note:** The endpoint returns `page_size=20`. If you expect high volume, increment `?page=2` etc., but for a 120-minute window a single page is almost always sufficient.

---

### 2. For Each Matching Record — Fetch Full Detail

```
GET https://platform.plaud.ai/developer/api/open/third-party/files/{id}
Authorization: Bearer !`echo $PLAUD_TOKEN`
```

Extract:
- `name` → will become the filename
- `note_list` → find the entry where `data_type == "auto_sum_note"`
- `data_content` from that entry → the markdown body of the summary

If no `auto_sum_note` entry exists in `note_list`, skip the record and log:
```
[plaud-ingest] Skipping {id} — no auto_sum_note found
```

---

### 3. Check for Existing File (Idempotency)

Target path:
```
~/dk-vault/_ai_note_summaries/{name}.md
```

**Before writing**, check if the file already exists:

```python
import os
target_path = os.path.expanduser(f"~/dk-vault/_ai_note_summaries/{safe_name}.md")
if os.path.exists(target_path):
    print(f"[plaud-ingest] Skipping '{name}' — file already exists")
    continue
```

Sanitize the filename: replace `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|` with `-`.

---

### 4. Write the Summary File

Create `~/dk-vault/_ai_note_summaries/{name}.md` with this structure:

```markdown
---
plaud_id: {id}
recorded_at: {start_at}
created_by: plaud-ingest
---

# {name}

{data_content}

---
*Plaud recording ingested at {current_datetime_utc} UTC*
```

- `{data_content}` is inserted verbatim (it's already markdown from Plaud)
- `{current_datetime_utc}` is the wall-clock time of ingestion, not the recording time
- Create `_ai_note_summaries/` if it doesn't exist

---

### 5. Semantic Search via Qdrant Skill

> **Qdrant skill location:** Update the path in `references/qdrant-skill-path.md` to point to your installed Qdrant skill.

Construct the search query by combining the recording name and its timestamp for richer context:

```
query = f"{name} {start_at}"
```

Using the Qdrant skill, search the `meetings/` folder of the vault for the note most semantically similar to this query.

**What to pass to Qdrant:**
- Search text: `"{name} {start_at}"` (e.g. `"My notes from the meeting 2024-01-15T10:04:27"`)
- Scope: `~/dk-vault/meetings/` folder only
- Return: top 1 result (most similar note path)

If no result is returned or similarity is below threshold (defer to Qdrant skill defaults), skip the backlink step and log:
```
[plaud-ingest] No similar meeting note found for '{name}' — skipping backlink
```

---

### 6. Append Backlink to the Matched Meeting Note

Once the most similar meeting note path is found, append the following to the **bottom** of that file:

```markdown

## Related Plaud Summary

- [[_ai_note_summaries/{name}]] *(recorded {start_at})*
```

Use `>>` append (never overwrite) so existing content is never touched.

---

## Full Python Reference Script

```python
#!/usr/bin/env python3
"""
plaud_ingest.py — run by the plaud-ingest skill
"""
import os, sys, requests
from datetime import datetime, timedelta

VAULT = os.path.expanduser("~/dk-vault")
SUMMARIES_DIR = os.path.join(VAULT, "_ai_note_summaries")
MEETINGS_DIR  = os.path.join(VAULT, "meetings")
API_BASE      = "https://platform.plaud.ai/developer/api/open/third-party"
WINDOW_MINS   = 120
PAGE_SIZE     = 20

def get_token():
    token = os.environ.get("PLAUD_TOKEN", "").strip()
    if not token:
        sys.exit("[plaud-ingest] ERROR: PLAUD_TOKEN is not set")
    return token

def fetch_list(token):
    headers = {"Authorization": f"Bearer {token}"}
    url = f"{API_BASE}/files/?page_size={PAGE_SIZE}"
    r = requests.get(url, headers=headers, timeout=15)
    r.raise_for_status()
    return r.json().get("data", [])

def fetch_detail(token, record_id):
    headers = {"Authorization": f"Bearer {token}"}
    url = f"{API_BASE}/files/{record_id}"
    r = requests.get(url, headers=headers, timeout=15)
    r.raise_for_status()
    return r.json()

def parse_start_at(s):
    """Parse Plaud's start_at string (UTC, no tz suffix) to datetime."""
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None

def safe_filename(name):
    for ch in r'/\:*?"<>|':
        name = name.replace(ch, "-")
    return name.strip()

def extract_summary(detail):
    for item in detail.get("note_list", []):
        if item.get("data_type") == "auto_sum_note":
            return item.get("data_content", "")
    return None

def write_summary(name, record_id, start_at, content):
    os.makedirs(SUMMARIES_DIR, exist_ok=True)
    fname = safe_filename(name) + ".md"
    path  = os.path.join(SUMMARIES_DIR, fname)
    if os.path.exists(path):
        print(f"[plaud-ingest] Skipping '{name}' — already exists")
        return None
    now_utc = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
    body = f"""---
plaud_id: {record_id}
recorded_at: {start_at}
created_by: plaud-ingest
---

# {name}

{content}

---
*Plaud recording ingested at {now_utc} UTC*
"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    print(f"[plaud-ingest] Written: {path}")
    return fname

def append_backlink(meeting_note_path, summary_name, start_at):
    link_block = f"""
## Related Plaud Summary

- [[_ai_note_summaries/{summary_name}]] *(recorded {start_at})*
"""
    with open(meeting_note_path, "a", encoding="utf-8") as f:
        f.write(link_block)
    print(f"[plaud-ingest] Backlink appended to: {meeting_note_path}")

def main():
    token    = get_token()
    now_utc  = datetime.utcnow()
    cutoff   = now_utc - timedelta(minutes=WINDOW_MINS)
    records  = fetch_list(token)

    recent = []
    for rec in records:
        sa = rec.get("start_at")
        if not sa:
            continue
        dt = parse_start_at(sa)
        if dt and dt >= cutoff:
            recent.append(rec)

    print(f"[plaud-ingest] {len(recent)} record(s) in last {WINDOW_MINS} minutes")

    for rec in recent:
        rid      = rec["id"]
        name     = rec.get("name", rid)
        start_at = rec.get("start_at", "")

        detail  = fetch_detail(token, rid)
        content = extract_summary(detail)
        if content is None:
            print(f"[plaud-ingest] Skipping '{name}' — no auto_sum_note")
            continue

        fname = write_summary(name, rid, start_at, content)
        if fname is None:
            continue  # already existed

        # --- Qdrant semantic search step ---
        # Invoke the Qdrant skill here with:
        #   query  = f"{name} {start_at}"
        #   scope  = MEETINGS_DIR
        #   top_k  = 1
        # The skill should return the best-matching file path.
        # Replace the line below with your Qdrant skill invocation:
        matched_note_path = qdrant_skill_search(f"{name} {start_at}", MEETINGS_DIR)

        if matched_note_path and os.path.exists(matched_note_path):
            append_backlink(matched_note_path, fname, start_at)
        else:
            print(f"[plaud-ingest] No matching meeting note found for '{name}'")

# ─── Qdrant skill stub ──────────────────────────────────────────────────────
# Replace this function body with the actual call to your Qdrant skill.
# Expected interface:
#   query (str)  — search text, e.g. "Meeting name 2024-01-15T10:04:27"
#   scope (str)  — directory to search within the vault
# Returns: absolute path string of the best match, or None
def qdrant_skill_search(query, scope):
    raise NotImplementedError(
        "Wire in your Qdrant skill here. "
        "See references/qdrant-skill-path.md for integration notes."
    )
# ────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    main()
```

---

## Error Handling

| Situation | Behaviour |
|---|---|
| `PLAUD_TOKEN` not set | Hard exit with clear message |
| API returns non-200 | Raise, log HTTP status, abort |
| `start_at` unparseable | Skip that record, log warning |
| No `auto_sum_note` in record | Skip, log |
| Summary file already exists | Skip, log (idempotent) |
| Qdrant returns no match | Skip backlink, log, continue |
| Meeting note path missing on disk | Skip backlink, log |

---

## Qdrant Integration Notes

See `references/qdrant-skill-path.md` for where to point this skill at your Qdrant SKILL.md and how to pass the search query + vault scope through to it.

The search query intentionally includes `start_at` alongside the name so that time-proximate meeting notes score higher — e.g. a note from the same morning will be a better semantic match than a note with a similar name from three months ago.
