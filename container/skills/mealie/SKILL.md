---
name: mealie
description: Save recipes to Mealie, retrieve existing recipes, edit recipes, and suggest tags. Use whenever the user shares a recipe, asks to look up a recipe, wants to edit a recipe, or wants to manage their recipe collection.
allowed-tools: Bash(curl:*), Bash(python3:*)
---

# Mealie Recipe Manager

Base URL: `https://mealie.i.pupaya.net/api`
Auth header: `Authorization: Bearer $MEALIE_API_KEY`

## Critical API quirks (tested)

- **PATCH 500s on array fields** (recipeIngredient, recipeInstructions, tags). Only use PATCH for scalar fields (description, prepTime, etc.).
- **For arrays: always GET → modify → PUT.** This is the only reliable way to update ingredients, instructions, or tags.
- **food/unit objects with `id: null` cause 500.** When a parser result has `food.id: null`, set `food` to `null` and put the food name in `note`.
- **Tags require `id`, `name`, and `slug`.** New tags must be created first via POST, then referenced by their returned ID.

---

## Save a recipe from a URL

```bash
curl -s -X POST "https://mealie.i.pupaya.net/api/recipes/create-url" \
  -H "Authorization: Bearer $MEALIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/recipe"}'
# Returns the slug as a quoted string
```

---

## Save a recipe from text

### Step 1 — Create stub (only `name` accepted)

```bash
SLUG=$(curl -s -X POST "https://mealie.i.pupaya.net/api/recipes" \
  -H "Authorization: Bearer $MEALIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Recipe Name"}' | tr -d '"')
```

### Step 2 — Parse ingredients via NLP

```bash
PARSED=$(curl -s -X POST "https://mealie.i.pupaya.net/api/parser/ingredients" \
  -H "Authorization: Bearer $MEALIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "parser": "nlp",
    "ingredients": [
      "2 cups all-purpose flour",
      "1 tsp baking powder",
      "3 large eggs"
    ]
  }')
```

### Step 3 — GET the stub, merge everything, PUT it back

Use python3 to process the parser output and build the full recipe. This is important because:
- Parser results with `food.id: null` must be cleaned (set food to null, move name to note)
- PUT requires the full recipe object (GET first)

```bash
RECIPE=$(curl -s "https://mealie.i.pupaya.net/api/recipes/$SLUG" \
  -H "Authorization: Bearer $MEALIE_API_KEY")

UPDATED=$(python3 << 'PYEOF'
import json, sys

parsed = json.loads('''PASTE_PARSED_JSON_HERE''')
recipe = json.loads('''PASTE_RECIPE_JSON_HERE''')

# Clean parser output
ingredients = []
for p in parsed:
    ing = p['ingredient']
    # Food with null id → set to null, put name in note
    food = ing.get('food')
    if food and food.get('id') is None:
        food_name = food.get('name', '')
        note = ing.get('note', '')
        ing['note'] = f"{food_name}, {note}".strip(', ') if note else food_name
        food = None
    elif food:
        food = {'id': food['id'], 'name': food['name']}
    # Unit with null id → set to null
    unit = ing.get('unit')
    if unit and unit.get('id') is None:
        unit = None
    elif unit:
        unit = {'id': unit['id'], 'name': unit['name']}

    ingredients.append({
        'quantity': ing.get('quantity', 0),
        'unit': unit,
        'food': food,
        'note': ing.get('note', ''),
        'originalText': p.get('input', ''),
        'referenceId': ing.get('referenceId')
    })

recipe['recipeIngredient'] = ingredients
recipe['recipeInstructions'] = [
    {'text': 'Step 1 text here.'},
    {'text': 'Step 2 text here.'}
]
recipe['description'] = 'Description here'
recipe['prepTime'] = '15 minutes'
recipe['cookTime'] = '30 minutes'
recipe['recipeYield'] = '4 servings'

print(json.dumps(recipe))
PYEOF
)

curl -s -X PUT "https://mealie.i.pupaya.net/api/recipes/$SLUG" \
  -H "Authorization: Bearer $MEALIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$UPDATED"
```

### Step 4 — Add tags (requires existing tag IDs)

First list existing tags to find matches:
```bash
curl -s "https://mealie.i.pupaya.net/api/organizers/tags?perPage=100" \
  -H "Authorization: Bearer $MEALIE_API_KEY"
```

Create any new tags that don't exist yet:
```bash
curl -s -X POST "https://mealie.i.pupaya.net/api/organizers/tags" \
  -H "Authorization: Bearer $MEALIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "new-tag-name"}'
# Returns: {"id": "uuid", "name": "new-tag-name", "slug": "new-tag-name"}
```

Then GET → add tags with id+name+slug → PUT:
```bash
# Tags must have all three fields: id, name, slug
# Example tag object: {"id": "9505d2eb-...", "name": "dessert", "slug": "dessert"}
```

---

## Edit an existing recipe

### Find it
```bash
# Search
curl -s "https://mealie.i.pupaya.net/api/recipes?search=chocolate+cake&perPage=5" \
  -H "Authorization: Bearer $MEALIE_API_KEY"

# By slug
curl -s "https://mealie.i.pupaya.net/api/recipes/chocolate-cake" \
  -H "Authorization: Bearer $MEALIE_API_KEY"
```

### For scalar fields only (description, times, yield) — PATCH works
```bash
curl -s -X PATCH "https://mealie.i.pupaya.net/api/recipes/{slug}" \
  -H "Authorization: Bearer $MEALIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated description", "prepTime": "10 minutes"}'
```

### For ingredients, instructions, or tags — GET → modify → PUT
```bash
RECIPE=$(curl -s "https://mealie.i.pupaya.net/api/recipes/{slug}" \
  -H "Authorization: Bearer $MEALIE_API_KEY")

# Modify with python3, then PUT back
UPDATED=$(echo "$RECIPE" | python3 -c "
import sys, json
r = json.load(sys.stdin)
# Example: replace instructions
r['recipeInstructions'] = [
    {'text': 'New step 1.'},
    {'text': 'New step 2.'}
]
# Example: replace ingredients (note-only form, always works)
r['recipeIngredient'] = [
    {'note': '2 cups flour', 'originalText': '2 cups flour'},
    {'note': '1 tsp salt', 'originalText': '1 tsp salt'}
]
json.dump(r, sys.stdout)
")

curl -s -X PUT "https://mealie.i.pupaya.net/api/recipes/{slug}" \
  -H "Authorization: Bearer $MEALIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$UPDATED"
```

---

## Delete a recipe

```bash
curl -s -X DELETE "https://mealie.i.pupaya.net/api/recipes/{slug}" \
  -H "Authorization: Bearer $MEALIE_API_KEY"
```

---

## Retrieve recipes

```bash
# Search
curl -s "https://mealie.i.pupaya.net/api/recipes?search=pasta&perPage=10" \
  -H "Authorization: Bearer $MEALIE_API_KEY"

# Full recipe by slug
curl -s "https://mealie.i.pupaya.net/api/recipes/{slug}" \
  -H "Authorization: Bearer $MEALIE_API_KEY"

# Filter by tag (use tag ID or slug)
curl -s "https://mealie.i.pupaya.net/api/recipes?tags=dessert&perPage=20" \
  -H "Authorization: Bearer $MEALIE_API_KEY"
```

---

## RecipeStep fields

Only `text` is required. Use `title` for section headers (e.g. "Make the frosting"):
```json
{"title": "Optional Section Header", "text": "The actual instruction text."}
```

## RecipeIngredient — two forms

**Structured** (when parser returns valid IDs):
```json
{
  "quantity": 2.0,
  "unit": {"id": "valid-uuid", "name": "cup"},
  "food": {"id": "valid-uuid", "name": "flour"},
  "note": "sifted",
  "originalText": "2 cups flour, sifted"
}
```

**Note-only fallback** (always works, no ID needed):
```json
{"note": "2 cups flour, sifted", "originalText": "2 cups flour, sifted"}
```

---

## Tag workflow

1. List existing tags: GET `/api/organizers/tags?perPage=100`
2. Match recipe against existing tags
3. Create missing tags: POST `/api/organizers/tags` with `{"name": "tag-name"}`
4. Apply via GET recipe → add tag objects `{"id": "...", "name": "...", "slug": "..."}` → PUT

Common tag categories: meal type (breakfast, dinner, dessert), cuisine (italian, mexican), diet (vegetarian, gluten-free), method (baked, grilled, slow-cooker), time (quick, weeknight).

---

## Full workflow when user shares a recipe

1. If URL → POST `/api/recipes/create-url`
2. If text:
   a. POST stub with name → get `$SLUG`
   b. Parse ingredients via `/api/parser/ingredients`
   c. GET the stub recipe
   d. Clean parser output (null out food/unit with null IDs)
   e. Build full recipe with ingredients, instructions, description, timing
   f. PUT the complete recipe
3. List existing tags, suggest 3–5, ask user
4. Create new tags if needed, then GET → add tags → PUT
5. Confirm with link: `https://mealie.i.pupaya.net/r/{slug}`

## Full workflow when user wants to edit

1. Search or ask for recipe name/slug
2. GET the full recipe
3. Show current state, ask what to change
4. For scalar changes: PATCH
5. For ingredients/instructions/tags: GET → modify → PUT
6. Confirm with link
