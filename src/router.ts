import fs from 'fs';
import path from 'path';

import { Channel, NewMessage, OutboundFile } from './types.js';
import { formatLocalTime } from './timezone.js';
import { parseTextStyles, ChannelType } from './text-styles.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { logger } from './logger.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(
  messages: NewMessage[],
  timezone: string,
): string {
  const lines = messages.map((m) => {
    const displayTime = formatLocalTime(m.timestamp, timezone);
    return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}">${escapeXml(m.content)}</message>`;
  });

  const header = `<context timezone="${escapeXml(timezone)}" />\n`;

  return `${header}<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function formatOutbound(rawText: string, channel?: ChannelType): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  return channel ? parseTextStyles(text, channel) : text;
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}

// Marker: [send-file:/workspace/group/path/to/file.ext]
// The agent writes a file to /workspace/group/ then references it with this marker.
// NanoClaw resolves the container path to the host group folder and reads the file.
const SEND_FILE_RE = /\[send-file:([^\]]+)\]/g;

export function resolveOutboundFiles(
  text: string,
  groupFolder: string,
): { cleanText: string; files: OutboundFile[] } {
  if (!text.includes('[send-file:')) return { cleanText: text, files: [] };

  const files: OutboundFile[] = [];
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(groupFolder);
  } catch (err) {
    logger.warn({ groupFolder, err }, 'resolveOutboundFiles: invalid group folder');
    return { cleanText: text, files: [] };
  }

  const cleanText = text
    .replace(SEND_FILE_RE, (_, containerPath: string) => {
      const prefix = '/workspace/group/';
      if (!containerPath.startsWith(prefix)) {
        logger.warn({ containerPath }, 'send-file: path must start with /workspace/group/');
        return '';
      }
      const relative = containerPath.slice(prefix.length);
      const hostPath = path.resolve(groupDir, relative);
      // Security: ensure path stays within group dir
      const rel = path.relative(groupDir, hostPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        logger.warn({ containerPath, hostPath }, 'send-file: path escapes group folder, blocked');
        return '';
      }
      try {
        const buffer = fs.readFileSync(hostPath);
        files.push({ name: path.basename(hostPath), buffer });
        logger.info({ hostPath, size: buffer.length }, 'send-file: resolved attachment');
      } catch (err) {
        logger.warn({ hostPath, err }, 'send-file: could not read file');
      }
      return '';
    })
    .trim();

  return { cleanText, files };
}
