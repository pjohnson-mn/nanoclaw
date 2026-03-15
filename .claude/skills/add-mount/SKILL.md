---
name: add-mount
description: Add a host directory mount to a NanoClaw container group. Handles the mount allowlist, database containerConfig, and path formatting. Use when the user wants to give a container agent access to a folder on the host.
---

# Add Container Mount

This skill adds a host directory mount to a NanoClaw container group so the agent can access files on the host filesystem.

## How Container Mounts Work

Additional mounts are configured in two places:

1. **Mount allowlist** (`~/.config/nanoclaw/mount-allowlist.json`) — security gate that controls which host paths are permitted. Stored outside the project root so container agents cannot modify it.
2. **Database** (`store/messages.db`, `registered_groups.container_config` column) — per-group mount configuration as JSON.

The validation code in `src/mount-security.ts` automatically prepends `/workspace/extra/` to the `containerPath`, so the value stored in the database must be **relative** (no leading `/`).

## Phase 1: Gather Information

Use `AskUserQuestion` to collect:

1. **Host path** — absolute path on the host (e.g., `/home/user/my-notes`, `~/projects/my-repo`)
2. **Group** — which registered group should get the mount (default: the main group). List registered groups if needed:
   ```bash
   node -e "
   const Database = require('better-sqlite3');
   const db = new Database('store/messages.db', { readonly: true });
   console.log(JSON.stringify(db.prepare('SELECT folder, name, jid FROM registered_groups').all(), null, 2));
   db.close();
   "
   ```
3. **Read-only or read-write** — whether the agent can modify files (default: read-only is safer)
4. **Container path name** — what to call it inside the container (default: basename of host path)

## Phase 2: Validate the Host Path

Verify the host path exists:

```bash
ls -la /path/to/directory
```

If it does not exist, ask the user to confirm or create it.

## Phase 3: Update the Mount Allowlist

The allowlist lives at `~/.config/nanoclaw/mount-allowlist.json`.

### If the file does not exist

Create it with the necessary structure:

```bash
mkdir -p ~/.config/nanoclaw
```

Write a new allowlist:

```json
{
  "allowedRoots": [
    {
      "path": "/home/user/my-notes",
      "allowReadWrite": true,
      "description": "User's notes directory"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
```

### If the file exists

Read it, then add or update the `allowedRoots` entry. The host path (or a parent directory) must appear in `allowedRoots`. If a parent is already listed, no changes are needed.

**Important fields:**
- `path` — the allowed root directory (can use `~` for home). Can be a parent of the actual mount.
- `allowReadWrite` — set to `true` if the user wants read-write access, `false` for read-only.
- `description` — human-readable note about what this directory is for.

**`nonMainReadOnly`** — if `true`, non-main groups are forced to read-only regardless of the mount config. Only change this if the user explicitly asks.

### Built-in blocked patterns

These path components are always blocked and cannot be overridden:
`.ssh`, `.gnupg`, `.gpg`, `.aws`, `.azure`, `.gcloud`, `.kube`, `.docker`, `credentials`, `.env`, `.netrc`, `.npmrc`, `.pypirc`, `id_rsa`, `id_ed25519`, `private_key`, `.secret`

If the user's path contains any of these, warn them that the mount will be rejected by the security layer.

## Phase 4: Update the Database

The `registered_groups` table has a `container_config` column storing JSON.

### Path formatting rules

**`hostPath`** — must be an absolute path on the host. Examples:
- `/home/user/my-notes`
- `/home/user/projects/my-repo`

**`containerPath`** — must be **relative** (no leading `/`). The validation code automatically prepends `/workspace/extra/`, so:
- `my-notes` becomes `/workspace/extra/my-notes` in the container
- `dk-vault` becomes `/workspace/extra/dk-vault` in the container
- `/workspace/extra/dk-vault` is **WRONG** — this would become `/workspace/extra//workspace/extra/dk-vault`

**`readonly`** — `true` or `false`. Defaults to `true` for safety. Even if set to `false`, the allowlist can override this (if `allowReadWrite` is `false` on the root, or `nonMainReadOnly` is `true` for non-main groups).

### Read current config

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('store/messages.db', { readonly: true });
const row = db.prepare('SELECT container_config FROM registered_groups WHERE folder = ?').get('GROUP_FOLDER');
console.log(JSON.stringify(JSON.parse(row.container_config || '{}'), null, 2));
db.close();
"
```

### Write updated config

If `container_config` is empty or `{}`, create a new one:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('store/messages.db');
const config = {
  additionalMounts: [
    {
      hostPath: '/home/user/my-notes',
      containerPath: 'my-notes',
      readonly: false
    }
  ]
};
db.prepare('UPDATE registered_groups SET container_config = ? WHERE folder = ?')
  .run(JSON.stringify(config), 'GROUP_FOLDER');
console.log('Updated:', JSON.stringify(config, null, 2));
db.close();
"
```

If `container_config` already has mounts, merge (don't overwrite existing mounts):

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('store/messages.db');
const row = db.prepare('SELECT container_config FROM registered_groups WHERE folder = ?').get('GROUP_FOLDER');
const config = JSON.parse(row.container_config || '{}');
if (!config.additionalMounts) config.additionalMounts = [];
// Check for duplicate containerPath
const existing = config.additionalMounts.findIndex(m => m.containerPath === 'my-notes');
if (existing >= 0) {
  config.additionalMounts[existing] = { hostPath: '/home/user/my-notes', containerPath: 'my-notes', readonly: false };
} else {
  config.additionalMounts.push({ hostPath: '/home/user/my-notes', containerPath: 'my-notes', readonly: false });
}
db.prepare('UPDATE registered_groups SET container_config = ? WHERE folder = ?')
  .run(JSON.stringify(config), 'GROUP_FOLDER');
console.log('Updated:', JSON.stringify(config, null, 2));
db.close();
"
```

## Phase 5: Restart the Service

The mount allowlist is cached in memory, so a service restart is required for allowlist changes. Database changes to `container_config` take effect on the next container spawn (no restart needed), but restarting ensures a clean state.

```bash
# Linux (systemd)
systemctl --user restart nanoclaw
systemctl --user status nanoclaw --no-pager

# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Phase 6: Verify

Tell the user:

> The mount is configured. Send a message to your bot and ask it to list files in `/workspace/extra/CONTAINER_PATH` to verify the mount is working.

If the mount is not appearing, check:

1. **Allowlist loaded?** — Check logs for "Mount allowlist loaded successfully" or "Mount allowlist not found"
2. **Mount rejected?** — Check logs for "Additional mount REJECTED" with a reason
3. **Host path exists?** — The validation resolves symlinks via `realpathSync` — if the path doesn't exist, the mount is silently skipped
4. **Blocked pattern match?** — Any path component matching the built-in blocked patterns will be rejected

Debug with verbose logging:

```bash
LOG_LEVEL=debug systemctl --user restart nanoclaw
# Then trigger a message and check logs for "Container mount configuration" and "Mount validated successfully"
```

## Removing a Mount

To remove a mount, update the database to remove the entry from `additionalMounts`:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('store/messages.db');
const row = db.prepare('SELECT container_config FROM registered_groups WHERE folder = ?').get('GROUP_FOLDER');
const config = JSON.parse(row.container_config || '{}');
config.additionalMounts = (config.additionalMounts || []).filter(m => m.containerPath !== 'CONTAINER_PATH');
db.prepare('UPDATE registered_groups SET container_config = ? WHERE folder = ?')
  .run(JSON.stringify(config), 'GROUP_FOLDER');
console.log('Updated:', JSON.stringify(config, null, 2));
db.close();
"
```

Optionally remove the corresponding entry from `~/.config/nanoclaw/mount-allowlist.json` if no other groups use that root.
