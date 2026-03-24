#!/bin/sh
# Wrapper for @googleworkspace/cli MCP server (ruzan account).
# Refreshes the OAuth access token from the stored refresh token,
# then starts the gws MCP server with GOOGLE_WORKSPACE_CLI_TOKEN set.

TOKENS_FILE="/home/node/.gws/ruzan-tokens.json"
KEYS_FILE="/home/node/.gmail-mcp/ruzan/gcp-oauth.keys.json"

if [ ! -f "$TOKENS_FILE" ]; then
  echo "Error: $TOKENS_FILE not found. Run scripts/gws-auth.mjs on the host." >&2
  exit 1
fi

# Refresh the access token using the stored refresh token
ACCESS_TOKEN=$(node -e "
const fs = require('fs');
const tokens = JSON.parse(fs.readFileSync('$TOKENS_FILE', 'utf-8'));
const keys = JSON.parse(fs.readFileSync('$KEYS_FILE', 'utf-8'));
const { client_id, client_secret } = keys.installed;
const body = new URLSearchParams({
  grant_type: 'refresh_token',
  refresh_token: tokens.refresh_token,
  client_id,
  client_secret,
});
fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })
  .then(r => r.json())
  .then(d => {
    if (d.error) { process.stderr.write('Token refresh failed: ' + d.error + '\n'); process.exit(1); }
    process.stdout.write(d.access_token);
  })
  .catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });
")

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Error: failed to obtain access token" >&2
  exit 1
fi

exec env GOOGLE_WORKSPACE_CLI_TOKEN="$ACCESS_TOKEN" npx -y @googleworkspace/cli mcp
