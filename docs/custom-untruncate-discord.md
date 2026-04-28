# Discord Message Truncation Fix

## Problem

Long agent responses sent to Discord were silently truncated with an ellipsis. Discord enforces a 2000-character limit per message; responses exceeding that limit were cut off rather than split across multiple messages.

## Root Cause

`src/channels/chat-sdk-bridge.ts` already contains splitting logic (`splitForLimit`) that breaks outbound text into chunks when `maxTextLength` is configured. However, `src/channels/discord.ts` never passed `maxTextLength` to `createChatSdkBridge`, so the splitting path was never reached and the full text was handed to the Discord adapter as-is.

## Fix

Added `maxTextLength: 2000` to the `createChatSdkBridge` call in `src/channels/discord.ts`:

```ts
return createChatSdkBridge({
  adapter: discordAdapter,
  concurrency: 'concurrent',
  botToken: env.DISCORD_BOT_TOKEN,
  extractReplyContext,
  supportsThreads: true,
  maxTextLength: 2000,  // added
});
```

`splitForLimit` prefers paragraph breaks (`\n\n`), then line breaks (`\n`), then word boundaries, falling back to a hard character cut only as a last resort. The first chunk's message ID is returned so subsequent edits and reactions still target the head of the reply.

## Files Changed

| File | Change |
|------|--------|
| `src/channels/discord.ts` | Added `maxTextLength: 2000` to `createChatSdkBridge` config |
