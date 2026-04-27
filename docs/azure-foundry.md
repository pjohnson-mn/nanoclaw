# Azure AI Foundry Integration

Route NanoClaw agent containers through Azure AI Foundry instead of the default Anthropic API.

## How It Works

A host-side HTTP proxy strips unsupported beta headers before forwarding requests to the Foundry endpoint. The proxy runs in the NanoClaw host process and is reachable from agent containers via `host.docker.internal`.

```
Agent Container (Claude Code)
  → http://host.docker.internal:PORT  (bypasses OneCLI via NO_PROXY)
  → NanoClaw host proxy               (strips anthropic-beta: advisor-tool-*)
  → https://<resource>.services.ai.azure.com/anthropic/  (Foundry)
```

## Configuration

Add these to `.env`:

```bash
ANTHROPIC_FOUNDRY_API_KEY=<your Azure AI Foundry API key>
ANTHROPIC_FOUNDRY_BASE_URL=https://<resource>.services.ai.azure.com/anthropic/
ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5
ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-6
ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6
```

Restart the service. The proxy starts automatically when `ANTHROPIC_FOUNDRY_BASE_URL` is set.

## Why a Proxy Is Needed

Claude Code v2.1.116 hardcodes `anthropic-beta: advisor-tool-2026-03-01` in every API request. Azure AI Foundry rejects unknown beta headers with HTTP 400. The proxy (`src/providers/claude.ts`) strips this header before forwarding.

When Foundry adds support for this beta (or Claude Code stops sending it), the proxy becomes a no-op passthrough and can be removed.

## Architecture Decisions

### Why host-side, not container-side?

Agent containers route all HTTP/HTTPS through OneCLI's credential vault proxy (`http_proxy` env var). OneCLI runs in its own Docker container on a separate network (`172.25.0.x`), while agent containers are on the default bridge (`172.17.0.x`). A proxy inside the agent container is unreachable from OneCLI because they're on different Docker networks.

The host-side proxy binds to `0.0.0.0` and is reachable from containers via `host.docker.internal`, which resolves to the Docker host from any container network.

### Why NO_PROXY?

Even with the proxy on the host, Claude Code would route `host.docker.internal` requests through OneCLI's `http_proxy`. OneCLI doesn't need to see these requests (the Foundry API key is passed directly, not via OneCLI's vault), so we set `NO_PROXY=host.docker.internal` to bypass it.

### Why provider env vars are injected after OneCLI

OneCLI's `applyContainerConfig()` appends `-e ANTHROPIC_API_KEY=placeholder` to the Docker args. Docker uses last-wins for duplicate `-e` flags. Provider-contributed env vars must come after OneCLI's block in `container-runner.ts` so the real Foundry key overrides the placeholder.

## Key Files

| File | Role |
|------|------|
| `src/providers/claude.ts` | Reads `.env`, starts host proxy, registers container env contribution |
| `src/providers/index.ts` | Barrel that imports `claude.ts` |
| `src/container-runner.ts` | Injects env vars into Docker args (provider env after OneCLI) |
| `.env` | Foundry credentials and model aliases |

## Troubleshooting

**"Invalid API key"** — `ANTHROPIC_API_KEY=placeholder` is reaching the container. Verify provider env vars are injected after OneCLI in `container-runner.ts`. Run `docker inspect <container> --format '{{json .Config.Env}}' | tr ',' '\n' | grep ANTHROPIC` to check.

**"API retry" loop** — Requests aren't reaching the host proxy. Check that `NO_PROXY=host.docker.internal` is in the container env and that the proxy is running (`grep "Foundry proxy" logs/nanoclaw.log`).

**400 "Unexpected value for anthropic-beta"** — The proxy isn't stripping the header. Check `STRIP_BETAS` in `src/providers/claude.ts` includes the rejected value.

**Proxy not starting** — Check for port conflicts or `.env` parse errors. The proxy binds to `0.0.0.0:0` (OS-assigned port) so conflicts are rare.
