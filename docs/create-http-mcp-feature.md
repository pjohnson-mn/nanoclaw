# Adding HTTP MCP Server Support

## What was added

NanoClaw's MCP server config previously only supported stdio transport (command/args/env). This change adds support for HTTP (and future SSE) transports, matching what the Claude Agent SDK actually accepts.

## Files changed

### `src/container-config.ts`
Replaced the single `McpServerConfig` interface with a discriminated union:

```ts
export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;
```

- `McpStdioServerConfig` — command/args/env (existing behavior, unchanged)
- `McpHttpServerConfig` — `{ type: 'http', url, headers?, instructions? }`

### `container/agent-runner/src/providers/types.ts`
Same union on the container side, keeping it in sync with what the SDK's `mcpServers` option accepts.

### `container/agent-runner/src/config.ts`
Updated `RunnerConfig.mcpServers` to use the new union type instead of the inline stdio-only shape.

### `container/agent-runner/src/index.ts`
Fixed the loop that adds config-defined MCP servers — the log line assumed `serverConfig.command` always existed, which is not true for HTTP servers. Now uses `'type' in serverConfig ? serverConfig.type : 'stdio'` to get the transport name.

## How to add an HTTP MCP server to a group

Edit the group's `groups/<folder>/container.json`:

```json
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "https://example.com/mcp/endpoint",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

Headers are optional. The server will be available to the agent on the next container start.

## First use: phils-outlook

`groups/dm-with-phil/container.json` was updated to add the Outlook MCP server previously used in NanoClaw v1:

```json
"phils-outlook": {
  "type": "http",
  "url": "https://webhookn8n.pupaya.net/mcp/outlook"
}
```

This server is an n8n webhook that proxies Outlook/Microsoft 365 operations.
