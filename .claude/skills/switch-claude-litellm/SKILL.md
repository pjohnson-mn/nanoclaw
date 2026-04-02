---
name: switch-claude-litellm
description: Switch NanoClaw to use LiteLLM proxy for Claude API (work instance). Use when personal account is rate-limited or for work tasks.
---

# Switch to LiteLLM (Work Instance)

Switch NanoClaw's credential proxy to route through the LiteLLM endpoint.

## Steps

1. Read `.env` in the project root
2. Ensure these lines are present and uncommented (not prefixed with `#`):
   - `ANTHROPIC_API_KEY` (must have a value — the LiteLLM API key)
   - `ANTHROPIC_BASE_URL` (must have a value — the LiteLLM endpoint URL)
   - `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
   - `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`
3. The `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, and `ANTHROPIC_DEFAULT_HAIKU_MODEL` lines are optional — only uncomment if customizing model names
4. `CLAUDE_CODE_OAUTH_TOKEN` can stay — it's ignored when `ANTHROPIC_API_KEY` is set
   - Note: `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` and any uncommented `ANTHROPIC_DEFAULT_*_MODEL` values are automatically injected into containers at runtime — no extra steps needed
5. Run `npm run build` and `systemctl --user restart nanoclaw`
6. Verify with: `grep "Credential proxy" logs/nanoclaw.log | tail -1` — must show `foundry: true`
7. Quick smoke test using the value of `ANTHROPIC_DEFAULT_HAIKU_MODEL` from `.env` as the model name: `curl -s -X POST "http://172.17.0.1:3001/v1/messages" -H "Content-Type: application/json" -H "x-api-key: placeholder" -H "anthropic-version: 2023-06-01" -d '{"model":"<value of ANTHROPIC_DEFAULT_HAIKU_MODEL>","max_tokens":20,"messages":[{"role":"user","content":"hi"}]}'` — should return a 200 JSON response with `"type":"message"`
8. Tell the user the switch is complete and show the smoke test result
