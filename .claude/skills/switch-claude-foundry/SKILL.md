---
name: switch-claude-foundry
description: Switch NanoClaw to use Microsoft Azure AI Foundry for Claude API (work instance). Use when personal account is rate-limited or for work tasks.
---

# Switch to Azure AI Foundry

Switch NanoClaw's credential proxy to route through the Microsoft Azure AI Foundry endpoint.

## Steps

1. Read `/.env` in the project root
2. Ensure these Foundry lines are present and uncommented (not prefixed with `#`):
   - `CLAUDE_CODE_USE_FOUNDRY=1`
   - `ANTHROPIC_FOUNDRY_API_KEY=...` (must have a value)
   - `ANTHROPIC_FOUNDRY_BASE_URL=https://aiede-general-holon-resource.services.ai.azure.com/anthropic/`
3. The `ANTHROPIC_DEFAULT_*_MODEL` lines are optional — only uncomment if customizing model names
4. `CLAUDE_CODE_OAUTH_TOKEN` can stay — it's ignored when Foundry is active
5. Run `npm run build` and `systemctl --user restart nanoclaw`
6. Verify with: `grep "Credential proxy" logs/nanoclaw.log | tail -1` — must show `foundry: true`
7. Quick smoke test: `curl -s -X POST "http://172.17.0.1:3001/v1/messages" -H "Content-Type: application/json" -H "x-api-key: placeholder" -H "anthropic-version: 2023-06-01" -d '{"model":"claude-haiku-4-5","max_tokens":20,"messages":[{"role":"user","content":"hi"}]}'` — should return a 200 JSON response
8. Tell the user the switch is complete and show the smoke test result
