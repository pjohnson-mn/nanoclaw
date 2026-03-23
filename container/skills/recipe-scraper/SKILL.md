---
name: recipe-scraper
description: Scrape a cooking recipe from a URL, send a clean recipe card to chat, and save it to the Obsidian vault recipes folder.
allowed-tools: Bash(agent-browser:*), Bash(*)
---

# Recipe Scraper Skill

Extract cooking recipes from web URLs and save them to the Obsidian vault.

## When to Use

Use this skill when the user shares a URL to a cooking recipe, or asks you to save/grab/scrape a recipe from a link.

## Instructions

### 1. Open the URL and extract the recipe

Use `agent-browser` to load the page and get the content:

```bash
agent-browser open "<url>"
agent-browser snapshot --mode compact
```

From the page content, extract:
- **Title** of the recipe
- **Source** (the website/author)
- **Prep time**, **cook time**, **total time** (if available)
- **Servings** (if available)
- **Ingredients** as a bulleted list
- **Instructions** as numbered steps
- **Notes** (any tips, substitutions, or storage info)

Ignore all ads, life stories, pop-ups, and irrelevant content. Just get the recipe.

### 2. Send a recipe card to chat

Send a clean, readable recipe card via `mcp__nanoclaw__send_message`:

```
*<Title>*
Source: <url>
Serves: <servings> | Total: <time>

*Ingredients:*
- item 1
- item 2
...

*Directions:*
1. Step one
2. Step two
...

Saved to vault: recipes/<filename>
```

Keep it clean and scannable. Use WhatsApp-style formatting (* for bold).

### 3. Save to Obsidian vault

Save the recipe as a markdown file in `/workspace/extra/dk-vault/recipes/`.

**Filename**: `<Recipe Title>.md` — use the recipe title, replacing any invalid filename characters. Example: `Chicken Tikka Masala.md`

**Note format**:

```markdown
---
type: recipe
source: <url>
date_saved: YYYY-MM-DD
tags:
  - recipe
  - <cuisine-tag>
  - <protein-or-category-tag>
servings: <number or description>
prep_time: <if available>
cook_time: <if available>
total_time: <if available>
---

# <Recipe Title>

Source: [<website name>](<url>)

## Ingredients

- ingredient 1
- ingredient 2
- ...

## Directions

1. Step one.
2. Step two.
3. ...

## Notes

<Any tips, substitutions, variations, or storage instructions from the original recipe. Omit this section if none.>
```

### 4. Tag conventions

Use these tag patterns:
- `recipe` (always)
- Cuisine type: `italian`, `mexican`, `indian`, `thai`, `american`, `japanese`, etc.
- Main protein/category: `chicken`, `beef`, `vegetarian`, `seafood`, `pork`, `baking`, `dessert`, `soup`, `salad`, etc.
- Keep to 3-5 tags.

### 5. Git commit and push

After saving, always commit and push. This is mandatory — never skip this step.

```bash
git -C /workspace/extra/dk-vault add "recipes/<filename>"
git -C /workspace/extra/dk-vault commit -m "recipe: <Recipe Title>"
ENCODED_USER=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$GITEA_USER', safe=''))") && git -C /workspace/extra/dk-vault -c "url.https://$ENCODED_USER:$GITEA_TOKEN@g.i.pupaya.net/.insteadOf=https://g.i.pupaya.net/" push
```

If the push fails, report the error to the user but still confirm the recipe was saved locally.

### 6. Confirm

After saving and pushing, confirm briefly:

```
Saved: recipes/<Recipe Title>.md
Tags: #recipe #italian #chicken
```

## Important

- Don't ask clarifying questions — just scrape and save.
- If the page requires scrolling or clicking "see full recipe", do so with agent-browser.
- If the page has a "Jump to Recipe" button, click it first.
- If extraction fails (paywall, broken page), tell the user and suggest they paste the recipe text directly.
- Close the browser tab when done: `agent-browser close`
