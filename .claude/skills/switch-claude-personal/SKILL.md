---
name: switch-claude-personal
description: Switch NanoClaw to use personal Anthropic OAuth account (disable Foundry). Use when hitting Foundry issues or wanting to use personal Claude quota.
---

# Switch to Personal Claude Account

Switch NanoClaw's credential proxy from Azure Foundry back to the personal Anthropic OAuth account.

## Steps

1. Read `/.env` in the project root
2. Comment out all Foundry-related lines by prefixing with `#`:
   - `CLAUDE_CODE_USE_FOUNDRY=1`
   - `ANTHROPIC_FOUNDRY_API_KEY=...`
   - `ANTHROPIC_FOUNDRY_BASE_URL=...`
   - `ANTHROPIC_DEFAULT_OPUS_MODEL=...`
   - `ANTHROPIC_DEFAULT_SONNET_MODEL=...`
   - `ANTHROPIC_DEFAULT_HAIKU_MODEL=...`
3. Ensure `CLAUDE_CODE_OAUTH_TOKEN` is present and uncommented
4. Run `npm run build` and `systemctl --user restart nanoclaw`
5. Verify with: `grep "Credential proxy" logs/nanoclaw.log | tail -1` — should show `foundry: false` or no foundry field
6. Tell the user the switch is complete
