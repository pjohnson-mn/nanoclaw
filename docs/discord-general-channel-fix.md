# Discord #general Channel — Root Cause & Fix

## Symptoms

Alfred did not respond to any messages posted in the Discord `#general` channel.

## Root Cause

Two separate problems combined to block channel wiring.

### 1. Channel was never registered

The `messaging_groups` table had no row for the `#general` channel. The host router looks up inbound messages by `(channel_type, platform_id)` — if no row exists the message is silently dropped. Alfred's Discord integration only had one wired channel: the DM (`discord:@me:1482460970755555541`). The guild channel had never been registered.

### 2. `setup/register.ts` used a stale DB schema

Migration `010-engage-modes.ts` replaced the old `trigger_rules` (opaque JSON) and `response_scope` columns in `messaging_group_agents` with four explicit columns:

| Old | New |
|-----|-----|
| `trigger_rules` (JSON blob) | `engage_mode` (`'pattern'` \| `'mention'` \| `'mention-sticky'`) |
| `trigger_rules.pattern` | `engage_pattern` (regex string or `'.'` for match-all) |
| `response_scope` | `sender_scope` |
| _(implicit)_ | `ignored_message_policy` |

`register.ts` was still calling `createMessagingGroupAgent` with the old field names (`trigger_rules`, `response_scope`), which the function no longer accepted. Running the register step would have silently passed undefined values into the new columns.

## Fix

### `setup/register.ts` — updated to new schema

Replaced the stale `trigger_rules` / `response_scope` construction with the correct fields:

```typescript
// Before
const triggerRules = parsed.trigger
  ? JSON.stringify({ pattern: parsed.trigger, requiresTrigger: parsed.requiresTrigger })
  : null;
createMessagingGroupAgent({
  ...
  trigger_rules: triggerRules,
  response_scope: 'all',
});

// After
const engageMode = parsed.trigger ? 'pattern' : (parsed.requiresTrigger ? 'mention' : 'pattern');
const engagePattern = parsed.trigger || (parsed.requiresTrigger ? undefined : '.');
createMessagingGroupAgent({
  ...
  engage_mode: engageMode,
  engage_pattern: engagePattern ?? null,
  sender_scope: 'all',
  ignored_message_policy: 'drop',
});
```

The `--no-trigger-required` flag (which sets `requiresTrigger: false`) now correctly maps to `engage_mode='pattern'` + `engage_pattern='.'`, matching what migration 010 produces for legacy rows.

### Channel wiring added

Ran the register step to create the `messaging_groups` row and wire it to the `dm-with-phil` agent group:

```
platform_id : discord:1482424242019631259:1482424243198234789
channel_type: discord
engage_mode : pattern
engage_pattern: .          ← responds to every message, no trigger required
sender_scope: all
session_mode: shared
agent_group : dm-with-phil (Alfred)
```

`engage_pattern='.'` is the sentinel for "match all messages" — Alfred responds without requiring a mention or keyword trigger.
