import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock registry (registerChannel runs at import time)
vi.mock('./registry.js', () => ({ registerChannel: vi.fn() }));

import { GmailChannel, GmailChannelOpts } from './gmail.js';

function makeOpts(overrides?: Partial<GmailChannelOpts>): GmailChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: () => ({}),
    ...overrides,
  };
}

describe('GmailChannel', () => {
  let channel: GmailChannel;

  beforeEach(() => {
    channel = new GmailChannel(makeOpts(), 'ruzan');
  });

  describe('ownsJid', () => {
    it('returns true for account-prefixed gmail JIDs', () => {
      expect(channel.ownsJid('gmail-ruzan:abc123')).toBe(true);
      expect(channel.ownsJid('gmail-ruzan:thread-id-456')).toBe(true);
    });

    it('returns false for non-gmail JIDs', () => {
      expect(channel.ownsJid('12345@g.us')).toBe(false);
      expect(channel.ownsJid('tg:123')).toBe(false);
      expect(channel.ownsJid('dc:456')).toBe(false);
      expect(channel.ownsJid('user@s.whatsapp.net')).toBe(false);
    });

    it('returns false for other gmail account JIDs', () => {
      expect(channel.ownsJid('gmail-work:abc123')).toBe(false);
    });
  });

  describe('name', () => {
    it('includes account label', () => {
      expect(channel.name).toBe('gmail-ruzan');
    });
  });

  describe('isConnected', () => {
    it('returns false before connect', () => {
      expect(channel.isConnected()).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('sets connected to false', async () => {
      await channel.disconnect();
      expect(channel.isConnected()).toBe(false);
    });
  });

  describe('constructor options', () => {
    it('accepts custom poll interval', () => {
      const ch = new GmailChannel(makeOpts(), 'test', 30000);
      expect(ch.name).toBe('gmail-test');
    });

    it('defaults to unread query when no filter configured', () => {
      const ch = new GmailChannel(makeOpts(), 'test');
      const query = (
        ch as unknown as { buildQuery: () => string }
      ).buildQuery();
      expect(query).toBe('is:unread category:primary');
    });

    it('defaults with no options provided', () => {
      const ch = new GmailChannel(makeOpts(), 'test');
      expect(ch.name).toBe('gmail-test');
    });
  });
});
