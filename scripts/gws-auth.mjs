#!/usr/bin/env node
/**
 * One-time OAuth2 authorization for @googleworkspace/cli (Google Calendar).
 * Uses the existing GCP project OAuth client from ~/.gmail-mcp/ruzan/gcp-oauth.keys.json.
 * Saves tokens to ~/.config/gws/ruzan-tokens.json.
 *
 * Run once: node scripts/gws-auth.mjs
 */

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { createInterface } from 'readline';

const KEYS_PATH = path.join(os.homedir(), '.gmail-mcp', 'ruzan', 'gcp-oauth.keys.json');
const TOKENS_PATH = path.join(os.homedir(), '.config', 'gws', 'ruzan-tokens.json');
const REDIRECT_PORT = 4242;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

// Scopes for Google Calendar (read + write)
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

const keys = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf-8'));
const { client_id, client_secret } = keys.installed;

const params = new URLSearchParams({
  client_id,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPES.join(' '),
  access_type: 'offline',
  prompt: 'consent',
});

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

console.log('\nOpen this URL in a browser (use incognito and sign in as ruzanj.mn@gmail.com):\n');
console.log(authUrl);
console.log('\nWaiting for redirect...\n');

// Start a local server to catch the OAuth redirect
const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (code) {
      res.end('<h2>Authorization successful! You can close this tab.</h2>');
      server.close();
      resolve(code);
    } else {
      res.end(`<h2>Authorization failed: ${error}</h2>`);
      server.close();
      reject(new Error(`OAuth error: ${error}`));
    }
  });
  server.listen(REDIRECT_PORT);
  server.on('error', reject);
});

// Exchange code for tokens
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id,
    client_secret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  }),
});

const tokens = await tokenRes.json();

if (tokens.error) {
  console.error('Token exchange failed:', tokens.error_description || tokens.error);
  process.exit(1);
}

fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));

console.log(`\nTokens saved to ${TOKENS_PATH}`);
console.log('Setup complete!');
