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
import FormData from "form-data";
import { logger } from "./logger.js";
import { readEnvFile } from "./env.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const SILENCE_MS = 800;       // ms of quiet before treating speech as done
const TTS_VOICE  = "bm_lewis";    // voice name: nova | alloy | echo | shimmer
                              // (Kokoro voices: af_bella | af_sky | bf_emma …)
const TTS_MODEL  = "tts-1";
const LOG_CHANNEL = "general"; // text channel that receives transcripts
const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const TTS_BASE_DEFAULT = "https://api.openai.com/v1";

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

  (connection as any).on("error", (err: Error) => {
    logger.error({ err: err?.message }, "[voice] connection error");
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch (err: any) {
    logger.error({ err: err?.message, state: connection.state.status }, "[voice] entersState failed");
    connection.destroy();
    connections.delete(voiceChannel.guild.id);
    await textChannel.send("Failed to connect to voice — check logs.");
    return;
  }
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
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    await pipeline(opusStream, decoder, createWriteStream(tmpFile));

    // Wrap PCM in WAV header
    await pcmToWav(tmpFile, wavFile, 48000, 2, 16);
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
  const { GROQ_API_KEY } = readEnvFile(["GROQ_API_KEY"]);
  const audio = await fs.readFile(wavPath);
  const form  = new FormData();
  form.append("file",  audio, { filename: "audio.wav", contentType: "audio/wav" });
  form.append("model", "whisper-large-v3");

  const res = await fetch(GROQ_STT_URL, {
    method:  "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      ...form.getHeaders(),
    },
    body: form.getBuffer(),
  });
  if (!res.ok) throw new Error(`Groq STT ${res.status}: ${await res.text()}`);
  const { text } = await res.json() as { text: string };
  return text;
}

// ─── TTS: OpenAI-compatible (or Kokoro) ───────────────────────────────────────

async function synthesise(text: string, outPath: string): Promise<void> {
  const { OPENAI_API_KEY, OPENAI_TTS_BASE_URL } = readEnvFile(["OPENAI_API_KEY", "OPENAI_TTS_BASE_URL"]);
  const ttsBase = OPENAI_TTS_BASE_URL ?? TTS_BASE_DEFAULT;
  const res = await fetch(`${ttsBase}/audio/speech`, {
    method:  "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY ?? "not-needed"}`,
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
