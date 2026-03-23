---
name: openai-embeddings
description: Generate text embeddings using OpenAI API. Use when you need to create
  vector embeddings for semantic search, RAG, or storing in a vector database like Qdrant.

vars:
  - OPENAI_API_KEY
---

# OpenAI Embeddings

Generate vector embeddings using `text-embedding-3-small` (1536 dimensions) via the OpenAI REST API.

> Model: `text-embedding-3-small` — fast, cheap, 1536-dim output. Pairs with Qdrant collections using `"size": 1536`.

---

## Generate an Embedding

Write to `/tmp/embed_request.json`:

```json
{
  "model": "text-embedding-3-small",
  "input": "The text you want to embed goes here"
}
```

Then run:

```bash
curl -s -X POST "https://api.openai.com/v1/embeddings" \
  -H "Authorization: Bearer $(printenv OPENAI_API_KEY)" \
  -H "Content-Type: application/json" \
  -d @/tmp/embed_request.json
```

**Response:**
```json
{
  "data": [
    {
      "embedding": [0.0023, -0.0098, ...],
      "index": 0
    }
  ],
  "model": "text-embedding-3-small",
  "usage": { "prompt_tokens": 8, "total_tokens": 8 }
}
```

Extract just the embedding vector:

```bash
curl -s -X POST "https://api.openai.com/v1/embeddings" \
  -H "Authorization: Bearer $(printenv OPENAI_API_KEY)" \
  -H "Content-Type: application/json" \
  -d @/tmp/embed_request.json | jq '.data[0].embedding'
```

---

## Embed and Store in Qdrant (combined workflow)

Write to `/tmp/embed_request.json`:

```json
{
  "model": "text-embedding-3-small",
  "input": "Text to store"
}
```

Then embed and upsert in one pipeline:

```bash
VECTOR=$(curl -s -X POST "https://api.openai.com/v1/embeddings" \
  -H "Authorization: Bearer $(printenv OPENAI_API_KEY)" \
  -H "Content-Type: application/json" \
  -d @/tmp/embed_request.json | jq '.data[0].embedding')

cat > /tmp/qdrant_upsert.json <<EOF
{
  "points": [
    {
      "id": 1,
      "vector": $VECTOR,
      "payload": { "text": "Text to store", "source": "manual" }
    }
  ]
}
EOF

curl -s -X PUT "$(printenv QDRANT_URL)/collections/my_collection/points" \
  -H "Content-Type: application/json" \
  -d @/tmp/qdrant_upsert.json
```

---

## Embed and Search Qdrant (semantic search)

```bash
QUERY_VECTOR=$(curl -s -X POST "https://api.openai.com/v1/embeddings" \
  -H "Authorization: Bearer $(printenv OPENAI_API_KEY)" \
  -H "Content-Type: application/json" \
  -d '{"model": "text-embedding-3-small", "input": "search query here"}' \
  | jq '.data[0].embedding')

cat > /tmp/qdrant_search.json <<EOF
{
  "query": $QUERY_VECTOR,
  "limit": 5,
  "with_payload": true
}
EOF

curl -s -X POST "$(printenv QDRANT_URL)/collections/my_collection/points/query" \
  -H "Content-Type: application/json" \
  -d @/tmp/qdrant_search.json
```

---

## Guidelines

1. **ID generation**: Use a hash or timestamp for point IDs to avoid collisions — e.g., `$(date +%s%N | md5sum | head -c 16 | printf '%d\n' 0x$(cat))` or store a UUID in the payload and use a numeric hash as the ID.
2. **Batch when possible**: The `input` field accepts an array of strings — embed multiple texts in one API call.
3. **1536 dimensions**: Qdrant collections must be created with `"size": 1536` to match this model.
4. **Cosine distance**: Use `"distance": "Cosine"` in Qdrant — OpenAI embeddings are normalized.
5. **Store original text in payload**: Always include the source text in the Qdrant payload so you can return readable results.
