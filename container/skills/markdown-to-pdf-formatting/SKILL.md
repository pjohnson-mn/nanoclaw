# Skill: markdown-to-pdf-formatting

Convert Markdown files to clean, well-formatted PDFs using pandoc + Chromium headless. Handles tables, custom HTML widgets, and full-page-width rendering.

## When to use

- User asks to generate a PDF from a Markdown file
- User wants a printable/shareable version of notes or assessments
- User asks to render Markdown tables cleanly in a PDF

## Toolchain

```
Markdown → pandoc (→ HTML5) → Python post-processing → Chromium headless → PDF
```

All tools available on this system:
- `pandoc` — Markdown to HTML (handles tables, lists, headings natively)
- `/usr/bin/chromium` — headless PDF rendering
- `python3` — HTML post-processing and injection

---

## Step-by-step

### 1. Run pandoc — Markdown to HTML

```bash
pandoc input.md \
  -f markdown \
  -t html5 \
  --standalone \
  --metadata title="Document Title" \
  -o output.html
```

**Do NOT use `--css` with a file path** — Chromium headless doesn't load external `file://` CSS reliably. Inject CSS inline (step 3).

**Do NOT use `--from=markdown+raw_html`** to inject custom HTML into the Markdown source — pandoc treats indented lines inside raw HTML blocks as code blocks, escaping them as `<pre><code>`. Inject into the HTML output instead (step 3).

### 2. Post-process HTML with Python

```python
import subprocess, re

html = subprocess.run(
    ['pandoc', 'input.md', '-f', 'markdown', '-t', 'html5',
     '--standalone', '--metadata', 'title=My Title'],
    capture_output=True, text=True
).stdout

# CRITICAL: Remove pandoc's default width cap
html = html.replace('max-width: 36em;', 'max-width: none;')

# Inject CSS inline before </head>
html = html.replace('</head>', f'<style>{MY_CSS}</style>\n</head>')

with open('output.html', 'w') as f:
    f.write(html)
```

### 3. CSS template (proven working)

```css
@page { size: letter portrait; margin: 0.75in; }

body {
  font-family: 'Segoe UI', Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.5;
  color: #1a1a1a;
  /* DO NOT set max-width — page margins control width */
}

h1 { font-size: 16pt; border-bottom: 2px solid #333; padding-bottom: 4px; }
h2 { font-size: 12pt; border-bottom: 1px solid #bbb; padding-bottom: 2px; margin-top: 20px; }
h3 { font-size: 11pt; margin-top: 14px; }

table { width: 100%; border-collapse: collapse; margin: 10px 0 14px;
        font-size: 9.5pt; table-layout: auto; page-break-inside: avoid; }
th { background: #e8e8e8; font-weight: 700; text-align: left;
     padding: 5px 8px; border: 1px solid #aaa; }
td { padding: 5px 8px; border: 1px solid #ccc; vertical-align: top; }
tr:nth-child(even) td { background: #fafafa; }

pre, code { font-family: 'Courier New', monospace; font-size: 8.5pt;
            background: #f5f5f5; border: 1px solid #ddd; }
pre { padding: 10px 12px; white-space: pre; page-break-inside: avoid; }
```

### 4. Replace ASCII art / code blocks with styled HTML widgets

If the Markdown contains a fenced code block with ASCII box-drawing characters (╔══╗ dashboards), pandoc wraps it in `<pre><code>`. Replace it **after pandoc runs** using regex on the HTML output:

```python
WIDGET_HTML = '''<div class="dashboard">
<div class="dash-header">...</div>
<div class="dash-row">
<div class="dash-cell">...</div>
</div>
</div>'''

html = re.sub(r'<pre><code>╔.*?</code></pre>', WIDGET_HTML, html, flags=re.DOTALL)
```

All injected HTML must be **flush left (no indentation)** — but since we're injecting into the final HTML (not Markdown), this is automatic.

### 5. Generate PDF with Chromium

```bash
chromium --headless --disable-gpu --no-sandbox \
  --print-to-pdf=/output/file.pdf \
  --print-to-pdf-no-header \
  "file:///path/to/output.html"
```

---

## Known pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| Content squished to narrow column | Pandoc default `max-width: 36em` in template | `html.replace('max-width: 36em;', 'max-width: none;')` |
| Injected HTML shows as escaped code in output | Indented lines in `raw_html` block treated as code by pandoc | Inject into HTML output, not Markdown source |
| External CSS not applied | Chromium headless ignores `file://` CSS refs | Inject CSS inline via `<style>` tag |
| Delivering PDF via Discord | Base64 embedding limited to ~8KB (token constraint) | Use `[send-file:/workspace/group/file.pdf]` — nanoclaw reads and sends directly, supports up to 8MB |
| Emoji not rendering | Missing font | Chromium on this system renders emoji fine — no action needed |

---

## File size reference

| Content | Typical PDF size |
|---------|-----------------|
| Single assessment stage (10–15 sections + tables) | ~210–220 KB |
| 8 stages combined | ~470–490 KB |

---

## Full pipeline script

```python
import subprocess, re

SRC = '/path/to/input.md'
OUT_HTML = '/tmp/output.html'
OUT_PDF = '/path/to/output.pdf'

CSS = """
@page { size: letter portrait; margin: 0.75in; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1a1a1a; }
h1 { font-size: 16pt; border-bottom: 2px solid #333; padding-bottom: 4px; }
h2 { font-size: 12pt; border-bottom: 1px solid #bbb; padding-bottom: 2px; margin-top: 20px; }
table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font-size: 9.5pt; page-break-inside: avoid; }
th { background: #e8e8e8; font-weight: 700; text-align: left; padding: 5px 8px; border: 1px solid #aaa; }
td { padding: 5px 8px; border: 1px solid #ccc; vertical-align: top; }
tr:nth-child(even) td { background: #fafafa; }
"""

html = subprocess.run(
    ['pandoc', SRC, '-f', 'markdown', '-t', 'html5', '--standalone',
     '--metadata', f'title=My Document'],
    capture_output=True, text=True
).stdout

html = html.replace('max-width: 36em;', 'max-width: none;')
html = html.replace('</head>', f'<style>{CSS}</style>\n</head>')

# Optional: replace ASCII dashboard code block with styled HTML widget
# html = re.sub(r'<pre><code>╔.*?</code></pre>', WIDGET_HTML, html, flags=re.DOTALL)

with open(OUT_HTML, 'w') as f:
    f.write(html)

subprocess.run([
    'chromium', '--headless', '--disable-gpu', '--no-sandbox',
    f'--print-to-pdf={OUT_PDF}', '--print-to-pdf-no-header',
    f'file://{OUT_HTML}'
])
```

---

## Delivering the PDF to Discord

Write the PDF to `/workspace/group/` and use the `[send-file:]` marker:

```bash
chromium --headless --disable-gpu --no-sandbox \
  --print-to-pdf=/workspace/group/output.pdf \
  --print-to-pdf-no-header \
  "file:///tmp/output.html"
```

Then in your response:

```
[send-file:/workspace/group/output.pdf]
```

Nanoclaw reads the file from the host path and sends it as a Discord attachment. Supports files up to Discord's 8MB limit. Do NOT use the base64 `[send-attachment:...]` approach for binary files — it's limited to ~8KB.

