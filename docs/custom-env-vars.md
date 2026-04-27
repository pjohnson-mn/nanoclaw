# Custom Environment Variables

## How it works

Per-group env vars are defined in `groups/<folder>/container.json` under the `env` key and passed as `-e KEY=VALUE` to the container at spawn time.

## Adding env vars to a group

Edit the group's `container.json`:

```json
{
  "env": {
    "GITEA_USER": "you@example.com",
    "GITEA_TOKEN": "yourtoken"
  }
}
```

No rebuild required — changes take effect on the next container spawn. Restart the service to pick them up immediately:

```bash
systemctl --user restart nanoclaw
```

## Why not OneCLI?

OneCLI injects credentials as HTTP headers into proxied outbound requests. That works for API keys (e.g. Anthropic, OpenAI). It does not work for credentials that need to be available as shell environment variables — such as `GITEA_TOKEN`, which is used directly in `git` commands inside the container.

## Files changed to add this feature

- **`src/container-config.ts`** — added `env: Record<string, string>` to `ContainerConfig`, defaulting to `{}`
- **`src/container-runner.ts`** — added a loop in `buildContainerArgs()` that passes each `containerConfig.env` entry as `-e KEY=VALUE` before provider-contributed env vars
