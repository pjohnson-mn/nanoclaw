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
npm install @discordjs/voice prism-media @discordjs/opus
npm run build
```

If the build fails after install, read the error and fix it before continuing.
Common cause: missing native bindings for `@discordjs/opus` — run
`npm install @discordjs/opus --build-from-source` and rebuild.

---

## Phase 3 — Create `src/voice.ts`

Create the file exactly as follows:

```typescript
/**
 * NanoClaw voice skill — STT + TTS for Discord voice channels.
 * Transcripts are posted to #general so memory picks them up.
 *
 * Required env vars (add to .env / data/env/env):
 *   GROQ_API_KEY          — free at console.groq.com
 *   OPENAI_API_KEY        — reuse your existing key (for TTS)
 *   OPENAI_TTS_BASE_URL   — optional: point at Kokoro instead of OpenAI
 *                           e.g. http://localhost:8880/v1
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
} from "@discordjs/voice";
import { GuildMember, VoiceChannel, TextChannel, Guild } from "discord.js";
import prism from "prism-media";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import os from "os";

// ─── Config ──────────────────────────────────────────────────────────────────

const SILENCE_MS = 800;       // ms of quiet before treating speech as done
const TTS_VOICE  = "nova";    // voice name: nova | alloy | echo | shimmer
                              // (Kokoro voices: af_bella | af_sky | bf_emma …)
const TTS_MODEL  = "tts-1";
const LOG_CHANNEL = "general"; // text channel that receives transcripts
const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const TTS_BASE = process.env.OPENAI_TTS_BASE_URL ?? "https://api.openai.com/v1";

// ─── State ────────────────────────────────────────────────────────────────────

const connections = new Map<string, VoiceConnection>(); // guildId → connection

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function handleVoiceCommand(
  subcommand: "join" | "leave",
  member: GuildMember,
  textChannel: TextChannel,
  askClaude: (prompt: string) => Promise<string>
) {
  if (subcommand === "leave") return leaveChannel(member.guild.id, textChannel);
  if (subcommand === "join")  return joinChannel(member, textChannel, askClaude);
}

// ─── Join ─────────────────────────────────────────────────────────────────────

async function joinChannel(
  member: GuildMember,
  textChannel: TextChannel,
  askClaude: (prompt: string) => Promise<string>
) {
  const voiceChannel = member.voice.channel as VoiceChannel | null;
  if (!voiceChannel) {
    return textChannel.send("You need to be in a voice channel first.");
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId:   voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,  // must be false to receive audio
  });

  connections.set(voiceChannel.guild.id, connection);
  await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  textChannel.send(
    `Joined **${voiceChannel.name}** — listening! Transcripts → #${LOG_CHANNEL}.`
  );

  const player = createAudioPlayer();
  connection.subscribe(player);

  connection.receiver.speaking.on("start", (userId) => {
    listenToUser(userId, voiceChannel.guild, connection, player, askClaude);
  });
}

// ─── Leave ────────────────────────────────────────────────────────────────────

function leaveChannel(guildId: string, textChannel: TextChannel) {
  const conn = connections.get(guildId);
  if (!conn) return textChannel.send("I'm not in a voice channel.");
  conn.destroy();
  connections.delete(guildId);
  textChannel.send("Left the voice channel.");
}

// ─── Log to #general ─────────────────────────────────────────────────────────

async function logToGeneral(guild: Guild, message: string) {
  const channel = guild.channels.cache.find(
    (c) => c.isTextBased() && c.name === LOG_CHANNEL
  ) as TextChannel | undefined;
  if (channel) await channel.send(message);
}

// ─── Capture → transcribe → respond ──────────────────────────────────────────

async function listenToUser(
  userId: string,
  guild: Guild,
  connection: VoiceConnection,
  player: ReturnType<typeof createAudioPlayer>,
  askClaude: (prompt: string) => Promise<string>
) {
  // Don't overlap responses
  if (player.state.status === AudioPlayerStatus.Playing) return;

  const tmpFile = path.join(os.tmpdir(), `nc-voice-${userId}-${Date.now()}.pcm`);
  const wavFile = tmpFile.replace(".pcm", ".wav");

  try {
    // Capture Opus → PCM
    const opusStream = connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS },
    });
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 });
    await pipeline(opusStream, decoder, createWriteStream(tmpFile));

    // Wrap PCM in WAV header
    await pcmToWav(tmpFile, wavFile, 48000, 1, 16);
    await fs.unlink(tmpFile);

    // STT
    const transcript = await transcribe(wavFile);
    await fs.unlink(wavFile);
    if (!transcript.trim()) return;

    // Resolve display name
    const member = await guild.members.fetch(userId).catch(() => null);
    const name = member?.displayName ?? `User:${userId}`;

    // Log user speech to #general
    await logToGeneral(guild, `🎤 **${name}:** ${transcript}`);

    // Ask Claude
    const reply = await askClaude(transcript);

    // Log bot reply to #general
    await logToGeneral(guild, `🤖 **NanoClaw:** ${reply}`);

    // TTS → play
    const speechFile = path.join(os.tmpdir(), `nc-tts-${Date.now()}.mp3`);
    await synthesise(reply, speechFile);
    player.play(createAudioResource(speechFile));
    player.once(AudioPlayerStatus.Idle, () => fs.unlink(speechFile).catch(() => {}));

  } catch (err) {
    console.error("[voice] error:", err);
    await fs.unlink(tmpFile).catch(() => {});
    await fs.unlink(wavFile).catch(() => {});
  }
}

// ─── STT: Groq Whisper ────────────────────────────────────────────────────────

async function transcribe(wavPath: string): Promise<string> {
  const audio = await fs.readFile(wavPath);
  const form  = new FormData();
  form.append("file",  new Blob([audio], { type: "audio/wav" }), "audio.wav");
  form.append("model", "whisper-large-v3");

  const res = await fetch(GROQ_STT_URL, {
    method:  "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Groq STT ${res.status}: ${await res.text()}`);
  const { text } = await res.json() as { text: string };
  return text;
}

// ─── TTS: OpenAI-compatible (or Kokoro) ───────────────────────────────────────

async function synthesise(text: string, outPath: string): Promise<void> {
  const res = await fetch(`${TTS_BASE}/audio/speech`, {
    method:  "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? "not-needed"}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: text }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  await fs.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

// ─── PCM → WAV ────────────────────────────────────────────────────────────────

async function pcmToWav(
  pcmPath: string, wavPath: string,
  sampleRate: number, channels: number, bitDepth: number
) {
  const pcm      = await fs.readFile(pcmPath);
  const header   = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitDepth) / 8;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bitDepth) / 8, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  await fs.writeFile(wavPath, Buffer.concat([header, pcm]));
}
```

---

## Phase 4 — Wire into the Discord message handler

Open the file that handles Discord messages (likely `src/channels/discord.ts`
or `src/index.ts`). Read it fully before making changes.

Add the import at the top:

```typescript
import { handleVoiceCommand } from "./voice";
```

Find the existing `messageCreate` (or equivalent) handler where the bot already
calls Claude. In that same handler, add voice command routing **before** the
existing Claude call so it short-circuits:

```typescript
// Voice commands: "!nano voice join" / "!nano voice leave"
if (content.startsWith("voice join") || content.startsWith("voice leave")) {
  const subcommand = content.startsWith("voice join") ? "join" : "leave";
  await handleVoiceCommand(
    subcommand,
    message.member as GuildMember,
    message.channel as TextChannel,
    askClaude          // pass in whatever function you already use to call Claude
  );
  return;
}
```

Replace `askClaude` with whatever the codebase calls its Claude invocation
function. Read the file to confirm the correct name.

Also ensure the Discord client is initialised with the `GuildVoiceStates`
intent. Find the `new Client({ intents: [...] })` call and add it if missing:

```typescript
GatewayIntentBits.GuildVoiceStates,
```

---

## Phase 5 — Add env vars

Add to `.env` (and `data/env/env` if that file exists):

```
GROQ_API_KEY=          # get free key at console.groq.com
OPENAI_TTS_BASE_URL=   # leave blank for OpenAI TTS, or set to Kokoro:
                       # http://localhost:8880/v1
```

If the user wants Kokoro (free, CPU, self-hosted), tell them to run:

```bash
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

And set `OPENAI_TTS_BASE_URL=http://localhost:8880/v1` in their `.env`.
The `OPENAI_API_KEY` value is ignored by Kokoro but must be present — set it
to `not-needed` if they have no OpenAI key.

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
2. Send `!nano voice join` in any registered text channel
3. Speak — their words should appear in `#general` as `🎤 **Name:** …`
4. The bot should reply in voice and post `🤖 **NanoClaw:** …` in `#general`
5. Send `!nano voice leave` when done

If the bot joins but stays silent, check:
- `GROQ_API_KEY` is set and valid
- TTS endpoint is reachable (`curl http://localhost:8880/v1/audio/speech` if using Kokoro)
- Bot has **Speak** and **Use Voice Activity** permissions in the voice channel

If transcription returns empty strings, the audio capture may be too short —
try speaking for longer before pausing.
