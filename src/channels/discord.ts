import {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  GuildMember,
  Interaction,
  Message,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel,
} from 'discord.js';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { handleVoiceCommand } from '../voice.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  OutboundFile,
  RegisteredGroup,
} from '../types.js';

import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

async function downloadAttachment(
  url: string,
  maxBytes: number,
): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) return null;
    return Buffer.from(buf);
  } catch {
    return null;
  }
}

async function extractDocxText(buf: Buffer): Promise<string | null> {
  try {
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value || null;
  } catch {
    return null;
  }
}

function extractXlsxText(buf: Buffer): string | null {
  try {
    const workbook = XLSX.read(buf, { type: 'buffer' });
    const sheets: string[] = [];
    for (const name of workbook.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      if (csv.trim()) sheets.push(`--- Sheet: ${name} ---\n${csv}`);
    }
    return sheets.length > 0 ? sheets.join('\n\n') : null;
  } catch {
    return null;
  }
}

function fileTextMarker(filename: string, content: string): string {
  return `[file:text:${filename}:${content}:endfile]`;
}

// Marker format: [send-attachment:filename.ext:base64data]
// The agent emits this in its response text to attach a file to the Discord message.
const SEND_ATTACHMENT_RE = /\[send-attachment:([^:\]]+):([A-Za-z0-9+/=\n]+)\]/g;

function parseAttachments(text: string): {
  cleanText: string;
  attachments: AttachmentBuilder[];
} {
  const attachments: AttachmentBuilder[] = [];
  const cleanText = text
    .replace(SEND_ATTACHMENT_RE, (_, name: string, b64: string) => {
      try {
        const buf = Buffer.from(b64.replace(/\s/g, ''), 'base64');
        attachments.push(new AttachmentBuilder(buf, { name }));
      } catch {
        // malformed base64 — skip silently
      }
      return '';
    })
    .trim();
  return { cleanText, attachments };
}

const slashCommands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription(`Ask ${ASSISTANT_NAME} a question`)
    .addStringOption((opt) =>
      opt.setName('message').setDescription('Your message').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('jot')
    .setDescription('Quickly capture a thought to your vault')
    .addStringOption((opt) =>
      opt
        .setName('thought')
        .setDescription('Your thought or idea')
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('j')
    .setDescription('Quickly capture a thought (shorthand for /jot)')
    .addStringOption((opt) =>
      opt
        .setName('thought')
        .setDescription('Your thought or idea')
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('chatid')
    .setDescription("Show this channel's ID for NanoClaw registration"),
];

export interface DiscordChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class DiscordChannel implements Channel {
  name = 'discord';

  private client: Client | null = null;
  private opts: DiscordChannelOpts;
  private botToken: string;

  constructor(botToken: string, opts: DiscordChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      // Ignore bot messages (including own)
      if (message.author.bot) return;

      const channelId = message.channelId;
      const chatJid = `dc:${channelId}`;
      let content = message.content;
      const timestamp = message.createdAt.toISOString();
      const senderName =
        message.member?.displayName ||
        message.author.displayName ||
        message.author.username;
      const sender = message.author.id;
      const msgId = message.id;

      // Determine chat name
      let chatName: string;
      if (message.guild) {
        const textChannel = message.channel as TextChannel;
        chatName = `${message.guild.name} #${textChannel.name}`;
      } else {
        chatName = senderName;
      }

      // Translate Discord @bot mentions into TRIGGER_PATTERN format.
      // Discord mentions look like <@botUserId> — these won't match
      // TRIGGER_PATTERN (e.g., ^@Andy\b), so we prepend the trigger
      // when the bot is @mentioned.
      if (this.client?.user) {
        const botId = this.client.user.id;
        const isBotMentioned =
          message.mentions.users.has(botId) ||
          content.includes(`<@${botId}>`) ||
          content.includes(`<@!${botId}>`);

        if (isBotMentioned) {
          // Strip the <@botId> mention to avoid visual clutter
          content = content
            .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
            .trim();
          // Prepend trigger if not already present
          if (!TRIGGER_PATTERN.test(content)) {
            content = `@${ASSISTANT_NAME} ${content}`;
          }
        }
      }

      // Handle attachments — download and process supported types
      if (message.attachments.size > 0) {
        const parts: string[] = [];
        for (const att of message.attachments.values()) {
          const contentType = att.contentType || '';
          const name = att.name || 'file';

          if (SUPPORTED_IMAGE_TYPES.has(contentType) && att.url) {
            // Images → base64 image content block
            const buf = await downloadAttachment(att.url, MAX_ATTACHMENT_BYTES);
            if (buf) {
              parts.push(
                `[image:base64:${contentType}:${buf.toString('base64')}]`,
              );
            } else {
              parts.push(`[Image: ${name} (download failed or too large)]`);
            }
          } else if (contentType === 'application/pdf' && att.url) {
            // PDF → base64 document content block (Claude reads PDFs natively)
            const buf = await downloadAttachment(att.url, MAX_ATTACHMENT_BYTES);
            if (buf) {
              parts.push(
                `[document:base64:application/pdf:${buf.toString('base64')}]`,
              );
            } else {
              parts.push(`[PDF: ${name} (download failed or too large)]`);
            }
          } else if (contentType === 'text/plain' && att.url) {
            // Text files → inline text
            const buf = await downloadAttachment(att.url, MAX_ATTACHMENT_BYTES);
            if (buf) {
              parts.push(fileTextMarker(name, buf.toString('utf-8')));
            } else {
              parts.push(`[File: ${name} (download failed or too large)]`);
            }
          } else if (
            (contentType ===
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
              name.endsWith('.docx')) &&
            att.url
          ) {
            // DOCX → extract text
            const buf = await downloadAttachment(att.url, MAX_ATTACHMENT_BYTES);
            if (buf) {
              const text = await extractDocxText(buf);
              if (text) {
                parts.push(fileTextMarker(name, text));
              } else {
                parts.push(`[File: ${name} (could not extract text)]`);
              }
            } else {
              parts.push(`[File: ${name} (download failed or too large)]`);
            }
          } else if (
            (contentType ===
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
              name.endsWith('.xlsx')) &&
            att.url
          ) {
            // XLSX → extract as CSV
            const buf = await downloadAttachment(att.url, MAX_ATTACHMENT_BYTES);
            if (buf) {
              const text = extractXlsxText(buf);
              if (text) {
                parts.push(fileTextMarker(name, text));
              } else {
                parts.push(`[File: ${name} (could not extract text)]`);
              }
            } else {
              parts.push(`[File: ${name} (download failed or too large)]`);
            }
          } else if (contentType.startsWith('video/')) {
            parts.push(`[Video: ${att.name || 'video'}]`);
          } else if (contentType.startsWith('audio/')) {
            parts.push(`[Audio: ${att.name || 'audio'}]`);
          } else {
            parts.push(`[File: ${name}]`);
          }
        }
        if (content) {
          content = `${content}\n${parts.join('\n')}`;
        } else {
          content = parts.join('\n');
        }
      }

      // Handle reply context — include who the user is replying to
      if (message.reference?.messageId) {
        try {
          const repliedTo = await message.channel.messages.fetch(
            message.reference.messageId,
          );
          const replyAuthor =
            repliedTo.member?.displayName ||
            repliedTo.author.displayName ||
            repliedTo.author.username;
          content = `[Reply to ${replyAuthor}] ${content}`;
        } catch {
          // Referenced message may have been deleted
        }
      }

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

      // Store chat metadata for discovery
      const isGroup = message.guild !== null;
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        chatName,
        'discord',
        isGroup,
      );

      // Only deliver full message for registered groups
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Discord channel',
        );
        return;
      }

      // Deliver message — startMessageLoop() will pick it up
      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Discord message stored',
      );
    });

    // Handle errors gracefully
    this.client.on(Events.Error, (err) => {
      logger.error({ err: err.message }, 'Discord client error');
    });

    // Handle slash command interactions
    this.client.on(
      Events.InteractionCreate,
      async (interaction: Interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const { commandName, channelId } = interaction;
        const chatJid = `dc:${channelId}`;

        if (commandName === 'chatid') {
          await interaction.reply({
            content: `Channel ID: \`${channelId}\`\nJID for registration: \`${chatJid}\``,
            ephemeral: true,
          });
          return;
        }

        if (
          commandName === 'ask' ||
          commandName === 'jot' ||
          commandName === 'j'
        ) {
          const isJot = commandName === 'jot' || commandName === 'j';
          const rawInput = interaction.options.getString(
            isJot ? 'thought' : 'message',
            true,
          );
          const senderName =
            interaction.member && 'displayName' in interaction.member
              ? (interaction.member.displayName as string)
              : interaction.user.displayName || interaction.user.username;
          const sender = interaction.user.id;
          const timestamp = new Date().toISOString();

          // Determine chat name
          let chatName: string;
          if (interaction.guild) {
            const channel = interaction.channel;
            const channelName =
              channel && 'name' in channel ? channel.name : channelId;
            chatName = `${interaction.guild.name} #${channelName}`;
          } else {
            chatName = senderName;
          }

          const isGroup = interaction.guild !== null;
          this.opts.onChatMetadata(
            chatJid,
            timestamp,
            chatName,
            'discord',
            isGroup,
          );

          const group = this.opts.registeredGroups()[chatJid];
          if (!group) {
            await interaction.reply({
              content:
                'This channel is not registered with NanoClaw. Use `/chatid` to get the channel ID, then register it.',
              ephemeral: true,
            });
            return;
          }

          // Acknowledge the interaction — the agent will reply via sendMessage
          if (isJot) {
            await interaction.reply({
              content: `**${senderName}** jotted: ${rawInput}`,
            });
          } else {
            await interaction.reply({
              content: `**${senderName}:** ${rawInput}`,
            });
          }

          // Prepend trigger so it passes through the trigger gate.
          // For jot commands, wrap with [Jot] prefix so the container skill triggers.
          const content = isJot
            ? `@${ASSISTANT_NAME} [Jot] ${rawInput}`
            : `@${ASSISTANT_NAME} ${rawInput}`;

          this.opts.onMessage(chatJid, {
            id: interaction.id,
            chat_jid: chatJid,
            sender,
            sender_name: senderName,
            content,
            timestamp,
            is_from_me: false,
          });

          logger.info(
            { chatJid, chatName, sender: senderName, command: commandName },
            'Discord slash command delivered',
          );
        }
      },
    );

    return new Promise<void>((resolve) => {
      this.client!.once(Events.ClientReady, async (readyClient) => {
        logger.info(
          { username: readyClient.user.tag, id: readyClient.user.id },
          'Discord bot connected',
        );

        // Register slash commands with Discord API
        try {
          const rest = new REST({ version: '10' }).setToken(this.botToken);
          await rest.put(Routes.applicationCommands(readyClient.user.id), {
            body: slashCommands.map((cmd) => cmd.toJSON()),
          });
          logger.info('Discord slash commands registered');
        } catch (err) {
          logger.error({ err }, 'Failed to register Discord slash commands');
        }

        console.log(`\n  Discord bot: ${readyClient.user.tag}`);
        console.log(`  Slash commands: /ask, /jot, /j, /chatid\n`);
        resolve();
      });

      this.client!.login(this.botToken);
    });
  }

  async sendMessage(jid: string, text: string, files?: OutboundFile[]): Promise<void> {
    // Resolve any pending voice reply before sending to the text channel
    const voiceResolve = this.pendingVoiceReplies.get(jid);
    if (voiceResolve) {
      this.pendingVoiceReplies.delete(jid);
      voiceResolve(text);
    }

    // Stop typing immediately — must happen before sending so no in-flight
    // interval callback can re-trigger typing after the message lands
    this.typingActive.delete(jid);
    const typingInterval = this.typingIntervals.get(jid);
    if (typingInterval) {
      clearInterval(typingInterval);
      this.typingIntervals.delete(jid);
    }

    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }

    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !('send' in channel)) {
        logger.warn({ jid }, 'Discord channel not found or not text-based');
        return;
      }

      const textChannel = channel as TextChannel;

      // Build attachment list from two sources:
      // 1. OutboundFile[] passed in from resolveOutboundFiles (path-based, preferred)
      // 2. [send-attachment:name:base64] markers embedded in text (fallback for small inline files)
      const { cleanText, attachments: inlineAttachments } = parseAttachments(text);
      const allAttachments: AttachmentBuilder[] = [
        ...(files ?? []).map((f) => new AttachmentBuilder(f.buffer, { name: f.name })),
        ...inlineAttachments,
      ];

      // Discord has a 2000 character limit per message — split if needed
      const MAX_LENGTH = 2000;
      if (cleanText.length <= MAX_LENGTH) {
        if (allAttachments.length > 0) {
          await textChannel.send({
            content: cleanText || undefined,
            files: allAttachments,
          });
        } else {
          await textChannel.send(cleanText);
        }
      } else {
        const chunks: string[] = [];
        for (let i = 0; i < cleanText.length; i += MAX_LENGTH) {
          chunks.push(cleanText.slice(i, i + MAX_LENGTH));
        }
        for (let i = 0; i < chunks.length; i++) {
          if (i === chunks.length - 1 && allAttachments.length > 0) {
            await textChannel.send({ content: chunks[i], files: allAttachments });
          } else {
            await textChannel.send(chunks[i]);
          }
        }
      }
      logger.info(
        { jid, length: text.length, attachmentCount: allAttachments.length },
        'Discord message sent',
      );
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Discord message');
    }
  }

  isConnected(): boolean {
    return this.client !== null && this.client.isReady();
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('dc:');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      logger.info('Discord bot stopped');
    }
  }

  // Track per-channel typing intervals and abort flags
  private typingIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private typingActive = new Set<string>();

  // Pending voice reply resolvers: chatJid → resolve fn
  private pendingVoiceReplies = new Map<string, (text: string) => void>();

  private makeAskClaude(
    chatJid: string,
    sender: string,
    senderName: string,
  ): (prompt: string) => Promise<string> {
    return (prompt: string) =>
      new Promise<string>((resolve) => {
        this.pendingVoiceReplies.set(chatJid, resolve);
        const timestamp = new Date().toISOString();
        this.opts.onMessage(chatJid, {
          id: `voice-${Date.now()}`,
          chat_jid: chatJid,
          sender,
          sender_name: senderName,
          content: `@${ASSISTANT_NAME} ${prompt}`,
          timestamp,
          is_from_me: false,
        });
        // Timeout after 30 seconds
        setTimeout(() => {
          if (this.pendingVoiceReplies.has(chatJid)) {
            this.pendingVoiceReplies.delete(chatJid);
            resolve("Sorry, I couldn't process that in time.");
          }
        }, 30000);
      });
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.client) return;

    if (!isTyping) {
      this.typingActive.delete(jid);
      const existing = this.typingIntervals.get(jid);
      if (existing) {
        clearInterval(existing);
        this.typingIntervals.delete(jid);
      }
      return;
    }

    // Already typing — don't stack intervals
    if (this.typingIntervals.has(jid)) return;

    this.typingActive.add(jid);

    const sendTyping = async () => {
      // Bail if typing was stopped while this call was queued/in-flight
      if (!this.typingActive.has(jid)) return;
      try {
        const channelId = jid.replace(/^dc:/, '');
        const channel = await this.client!.channels.fetch(channelId);
        if (this.typingActive.has(jid) && channel && 'sendTyping' in channel) {
          await (channel as TextChannel).sendTyping();
        }
      } catch (err) {
        logger.debug({ jid, err }, 'Failed to send Discord typing indicator');
      }
    };

    // Send immediately, then refresh every 8s (Discord typing expires after ~10s)
    await sendTyping();
    this.typingIntervals.set(jid, setInterval(sendTyping, 8000));
  }
}

registerChannel('discord', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['DISCORD_BOT_TOKEN']);
  const token =
    process.env.DISCORD_BOT_TOKEN || envVars.DISCORD_BOT_TOKEN || '';
  if (!token) {
    logger.warn('Discord: DISCORD_BOT_TOKEN not set');
    return null;
  }
  return new DiscordChannel(token, opts);
});
