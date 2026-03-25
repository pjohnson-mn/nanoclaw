---
name: add-voice
description: Add voice chat capability to Discord
---

Adds Discord voice channel support to NanoClaw — STT via Groq Whisper, TTS via
Kokoro-FastAPI (or any OpenAI-compatible TTS endpoint). Voice turns are
transcribed and posted to #general so memory and chat history see them.

---

## Phase 1 — Preflight

Check whether `src/voice.ts` already exists. If it does, skip to Phase 3.

Check that the Discord channel is installed (`src/channels/discord.ts` exists).
If it does not, tell the user to run `/add-discord` first, then stop.

---

## Phase 2 — Install dependencies

```bash
npm install @discordjs/voice prism-media @discordjs/opus libsodium-wrappers form-data
npm run build
```

**Required system packages** (host, not container — voice runs in the main process):

- **ffmpeg** — needed by `@discordjs/voice` to create audio resources for TTS playback.
  Without it you get: `Error: FFmpeg/avconv not found!`
  - Debian/Ubuntu/Raspberry Pi: `sudo apt install ffmpeg`
  - macOS: `brew install ffmpeg`

If the build fails after install, read the error and fix it before continuing.
Common cause: missing native bindings for `@discordjs/opus` — run
`npm install @discordjs/opus --build-from-source` and rebuild.

---

## Phase 3 — Create `src/voice.ts`

Create the file. Key differences from a naive implementation (lessons learned):

- **Use `readEnvFile()` not `process.env`** for secrets (`GROQ_API_KEY`,
  `OPENAI_API_KEY`, `OPENAI_TTS_BASE_URL`). NanoClaw keeps secrets out of
  `process.env` so they don't leak to child processes.
- **Use the `form-data` npm package** for the Groq multipart upload, not the
  browser `FormData` API. Node's built-in `FormData` does not produce correct
  `multipart/form-data` boundaries for file uploads — Groq returns
  `400: multipart: NextPart: EOF` if you use it. Pass `form.getHeaders()` and
  `form.getBuffer()` to `fetch()`.
- **Stereo audio (channels: 2)** — Discord sends stereo Opus. The decoder and
  WAV writer must both use `channels: 2`, not 1, or the audio will be garbled/
  half-speed.
- **Error handling on voice connection** — wrap `entersState()` in try/catch and
  add an error listener on the connection. Voice connections can ETIMEDOUT on
  networks with restrictive firewalls (see Troubleshooting below). Without the
  catch, an unhandled rejection crashes the process.
- **Use the project logger** (`import { logger } from './logger.js'`) instead of
  bare `console.error` so voice errors appear in structured logs.

```typescript
/**
 * NanoClaw voice skill — STT + TTS for Discord voice channels.
 * Transcripts are posted to #general so memory picks them up.
 *
 * Required env vars (add to .env):
 *   GROQ_API_KEY          — free at console.groq.com
 *   OPENAI_TTS_BASE_URL   — optional: point at Kokoro instead of OpenAI
 *                           e.g. http://hulk.homelab:8880/v1
 *
 * Kokoro (free, self-hosted CPU TTS):
 *   docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
 */

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  AudioPlayerStatus,
  VoiceConnection,
} from '@discordjs/voice';
import { GuildMember, VoiceChannel, TextChannel, Guild } from 'discord.js';
import prism from 'prism-media';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import FormData from 'form-data';
import { logger } from './logger.js';
import { readEnvFile } from './env.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const SILENCE_MS = 800;       // ms of quiet before treating speech as done
const TTS_VOICE  = 'bm_lewis'; // Kokoro voices: af_bella | af_sky | bm_lewis …
                                // OpenAI voices: nova | alloy | echo | shimmer
const TTS_MODEL  = 'tts-1';
const LOG_CHANNEL = 'general'; // text channel that receives transcripts
const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const TTS_BASE_DEFAULT = 'https://api.openai.com/v1';

// ─── State ────────────────────────────────────────────────────────────────────

const connections = new Map<string, VoiceConnection>(); // guildId → connection

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function handleVoiceCommand(
  subcommand: 'join' | 'leave',
  member: GuildMember,
  textChannel: TextChannel,
  askClaude: (prompt: string) => Promise<string>,
) {
  if (subcommand === 'leave') return leaveChannel(member.guild.id, textChannel);
  if (subcommand === 'join') return joinChannel(member, textChannel, askClaude);
}

// ─── Join ─────────────────────────────────────────────────────────────────────

async function joinChannel(
  member: GuildMember,
  textChannel: TextChannel,
  askClaude: (prompt: string) => Promise<string>,
) {
  const voiceChannel = member.voice.channel as VoiceChannel | null;
  if (!voiceChannel) {
    return textChannel.send('You need to be in a voice channel first.');
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false, // must be false to receive audio
  });

  connections.set(voiceChannel.guild.id, connection);

  // Log connection errors instead of crashing
  (connection as any).on('error', (err: Error) => {
    logger.error({ err: err?.message }, '[voice] connection error');
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch (err: any) {
    logger.error(
      { err: err?.message, state: connection.state.status },
      '[voice] entersState failed',
    );
    connection.destroy();
    connections.delete(voiceChannel.guild.id);
    await textChannel.send('Failed to connect to voice — check logs.');
    return;
  }

  textChannel.send(
    `Joined **${voiceChannel.name}** — listening! Transcripts → #${LOG_CHANNEL}.`,
  );

  const player = createAudioPlayer();
  connection.subscribe(player);

  connection.receiver.speaking.on('start', (userId) => {
    listenToUser(userId, voiceChannel.guild, connection, player, askClaude);
  });
}

// ─── Leave ────────────────────────────────────────────────────────────────────

function leaveChannel(guildId: string, textChannel: TextChannel) {
  const conn = connections.get(guildId);
  if (!conn) return textChannel.send("I'm not in a voice channel.");
  conn.destroy();
  connections.delete(guildId);
  textChannel.send('Left the voice channel.');
}

// ─── Log to #general ─────────────────────────────────────────────────────────

async function logToGeneral(guild: Guild, message: string) {
  const channel = guild.channels.cache.find(
    (c) => c.isTextBased() && c.name === LOG_CHANNEL,
  ) as TextChannel | undefined;
  if (channel) await channel.send(message);
}

// ─── Capture → transcribe → respond ──────────────────────────────────────────

async function listenToUser(
  userId: string,
  guild: Guild,
  connection: VoiceConnection,
  player: ReturnType<typeof createAudioPlayer>,
  askClaude: (prompt: string) => Promise<string>,
) {
  if (player.state.status === AudioPlayerStatus.Playing) return;

  const tmpFile = path.join(os.tmpdir(), `nc-voice-${userId}-${Date.now()}.pcm`);
  const wavFile = tmpFile.replace('.pcm', '.wav');

  try {
    // Capture Opus → PCM (stereo — Discord sends 2-channel audio)
    const opusStream = connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS },
    });
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    await pipeline(opusStream, decoder, createWriteStream(tmpFile));

    // Wrap PCM in WAV header (must match channels: 2)
    await pcmToWav(tmpFile, wavFile, 48000, 2, 16);
    await fs.unlink(tmpFile);

    // STT
    const transcript = await transcribe(wavFile);
    await fs.unlink(wavFile);
    if (!transcript.trim()) return;

    const member = await guild.members.fetch(userId).catch(() => null);
    const name = member?.displayName ?? `User:${userId}`;
    await logToGeneral(guild, `🎤 **${name}:** ${transcript}`);

    const reply = await askClaude(transcript);
    await logToGeneral(guild, `🤖 **NanoClaw:** ${reply}`);

    // TTS → play (requires ffmpeg on the host)
    const speechFile = path.join(os.tmpdir(), `nc-tts-${Date.now()}.mp3`);
    await synthesise(reply, speechFile);
    player.play(createAudioResource(speechFile));
    player.once(AudioPlayerStatus.Idle, () => fs.unlink(speechFile).catch(() => {}));
  } catch (err) {
    logger.error({ err }, '[voice] error');
    await fs.unlink(tmpFile).catch(() => {});
    await fs.unlink(wavFile).catch(() => {});
  }
}

// ─── STT: Groq Whisper ────────────────────────────────────────────────────────

async function transcribe(wavPath: string): Promise<string> {
  const { GROQ_API_KEY } = readEnvFile(['GROQ_API_KEY']);
  const audio = await fs.readFile(wavPath);
  // IMPORTANT: use npm form-data, NOT browser FormData — Node's built-in
  // FormData produces malformed multipart that Groq rejects with EOF error
  const form = new FormData();
  form.append('file', audio, { filename: 'audio.wav', contentType: 'audio/wav' });
  form.append('model', 'whisper-large-v3');

  const res = await fetch(GROQ_STT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, ...form.getHeaders() },
    body: form.getBuffer(),
  });
  if (!res.ok) throw new Error(`Groq STT ${res.status}: ${await res.text()}`);
  const { text } = (await res.json()) as { text: string };
  return text;
}

// ─── TTS: OpenAI-compatible (or Kokoro) ───────────────────────────────────────

async function synthesise(text: string, outPath: string): Promise<void> {
  const { OPENAI_API_KEY, OPENAI_TTS_BASE_URL } = readEnvFile([
    'OPENAI_API_KEY', 'OPENAI_TTS_BASE_URL',
  ]);
  const ttsBase = OPENAI_TTS_BASE_URL ?? TTS_BASE_DEFAULT;
  const res = await fetch(`${ttsBase}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY ?? 'not-needed'}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: text }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  await fs.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

// ─── PCM → WAV ────────────────────────────────────────────────────────────────

async function pcmToWav(
  pcmPath: string, wavPath: string,
  sampleRate: number, channels: number, bitDepth: number,
) {
  const pcm      = await fs.readFile(pcmPath);
  const header   = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitDepth) / 8;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bitDepth) / 8, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  await fs.writeFile(wavPath, Buffer.concat([header, pcm]));
}
```

---

## Phase 4 — Wire into the Discord message handler

Open `src/channels/discord.ts`. Read it fully before making changes.

Add the import at the top:

```typescript
import { handleVoiceCommand } from '../voice.js';
```

Find the `MessageCreate` handler. Add voice command routing **before** the
existing message delivery so it short-circuits:

```typescript
// Voice commands: "voice join" / "voice leave" (after trigger strip)
if (content.includes('voice join') || content.includes('voice leave')) {
  const subcommand = content.includes('voice join') ? 'join' : 'leave';
  const askClaude = this.makeAskClaude(chatJid, sender, senderName);
  await handleVoiceCommand(
    subcommand,
    message.member as GuildMember,
    message.channel as TextChannel,
    askClaude,
  );
  return;
}
```

The `makeAskClaude` helper routes the voice transcript through NanoClaw's
normal message pipeline (container agent) and resolves with the reply. It uses
a `pendingVoiceReplies` map — the `sendMessage` method checks this map before
sending to the text channel, resolving the promise so TTS can play the reply.
Read the existing `discord.ts` to see if `makeAskClaude` already exists; if not,
add it as a private method on the channel class.

Also ensure the Discord client is initialized with the `GuildVoiceStates`
intent. Find the `new Client({ intents: [...] })` call and add it if missing:

```typescript
GatewayIntentBits.GuildVoiceStates,
```

---

## Phase 5 — Add env vars

Add to `.env`:

```
GROQ_API_KEY=          # get free key at console.groq.com
OPENAI_TTS_BASE_URL=   # leave blank for OpenAI TTS, or set to Kokoro URL
```

If the user wants Kokoro (free, CPU, self-hosted), tell them to run:

```bash
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

And set `OPENAI_TTS_BASE_URL=http://<host>:8880/v1` in their `.env`.
Note: if Kokoro runs on a different machine on the LAN (e.g. `hulk.homelab`),
use that hostname instead of `localhost`.

The `OPENAI_API_KEY` value is ignored by Kokoro but the header is still sent —
`readEnvFile` returns undefined so it falls back to `'not-needed'`.

---

## Phase 6 — Build and restart

```bash
npm run build
```

Fix any build errors before restarting.

Restart the service:
- macOS: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`
- Linux: `systemctl --user restart nanoclaw`

---

## Phase 7 — Verify

Ask the user to:
1. Join a Discord voice channel
2. Send `@BotName voice join` in any registered text channel
3. Speak — their words should appear in `#general` as `🎤 **Name:** …`
4. The bot should reply in voice and post `🤖 **NanoClaw:** …` in `#general`
5. Send `@BotName voice leave` when done

---

## Troubleshooting

### `Error: FFmpeg/avconv not found!`
`createAudioResource()` shells out to ffmpeg to decode the MP3 from TTS.
Install ffmpeg on the **host** (not the container — voice runs in the main
NanoClaw process):
```bash
sudo apt install ffmpeg    # Debian/Ubuntu/RPi
brew install ffmpeg        # macOS
```

### `Groq STT 400: multipart: NextPart: EOF`
You used the browser `FormData` API instead of the `form-data` npm package.
Node's built-in `FormData` does not produce correct multipart boundaries for
file uploads. Use `form-data` with `form.getHeaders()` and `form.getBuffer()`.

### `TTS 401: Incorrect API key provided: not-needed`
You're hitting the real OpenAI endpoint instead of your local Kokoro instance.
Check that `OPENAI_TTS_BASE_URL` is set in `.env` and points to the correct
host/port (e.g. `http://hulk.homelab:8880/v1`).

### Voice connection ETIMEDOUT / entersState failed
Discord voice uses **UDP** for media transport. If the host has a restrictive
firewall:
- **Linux (UFW):** Ensure outbound UDP is not blocked. Discord voice servers
  use a wide port range. The simplest fix:
  ```bash
  sudo ufw allow out proto udp to any
  ```
- **Router/NAT:** The bot needs outbound UDP to Discord's voice server IPs
  (varies). If behind a strict corporate firewall, voice may not work.
- Check logs for `[voice] connection error` and `[voice] entersState failed`
  with the connection state at time of failure.

### Bot joins but stays silent
- Verify `GROQ_API_KEY` is set and valid in `.env`
- Verify TTS endpoint is reachable: `curl http://<host>:8880/v1/audio/speech`
- Bot needs **Speak** and **Use Voice Activity** permissions in Discord
- `selfDeaf` must be `false` in `joinVoiceChannel()` or the bot can't hear

### Transcription returns empty strings
Audio capture may be too short — the silence threshold is 800ms. Try speaking
for longer before pausing. Groq also returns empty for very quiet audio.
