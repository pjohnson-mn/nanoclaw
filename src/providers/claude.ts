import http from 'http';
import https from 'https';
import { URL } from 'url';

import { log } from '../log.js';
import { readEnvFile } from '../env.js';
import { registerProviderContainerConfig } from './provider-container-registry.js';

const FOUNDRY_KEYS = [
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
];

const foundryEnv = readEnvFile(FOUNDRY_KEYS);

// Beta headers Foundry rejects with 400.
const STRIP_BETAS = new Set(['advisor-tool-2026-03-01']);

let proxyPort: number | null = null;

function startFoundryProxy(targetBaseUrl: string): Promise<number> {
  const target = new URL(targetBaseUrl);
  const targetBase = target.pathname.replace(/\/$/, '');

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('error', (err) => {
        log.error('[foundry-proxy] req error', { err: err.message });
        if (!res.headersSent) { res.writeHead(400); res.end(); }
      });
      req.on('end', () => {
        const body = Buffer.concat(chunks);

        const outHeaders: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (k === 'host') continue;
          if (k === 'anthropic-beta' && typeof v === 'string') {
            const kept = v.split(',').map((b) => b.trim()).filter((b) => !STRIP_BETAS.has(b));
            if (kept.length) outHeaders[k] = kept.join(', ');
            continue;
          }
          if (v !== undefined) outHeaders[k] = v;
        }
        if (body.length) outHeaders['content-length'] = String(body.length);

        const options: https.RequestOptions = {
          hostname: target.hostname,
          port: Number(target.port) || 443,
          path: targetBase + (req.url ?? '/'),
          method: req.method,
          headers: outHeaders,
        };

        const proxyReq = https.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          log.error('[foundry-proxy] upstream error', { err: err.message });
          if (!res.headersSent) { res.writeHead(502); res.end(err.message); }
        });

        if (body.length) proxyReq.write(body);
        proxyReq.end();
      });
    });

    server.on('error', reject);
    server.listen(0, '0.0.0.0', () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

// Start proxy eagerly at module load so the port is ready before first container spawn.
if (foundryEnv.ANTHROPIC_FOUNDRY_BASE_URL) {
  startFoundryProxy(foundryEnv.ANTHROPIC_FOUNDRY_BASE_URL)
    .then((port) => {
      proxyPort = port;
      log.info('Foundry proxy started on host', { port });
    })
    .catch((err) => {
      log.error('Failed to start Foundry proxy', { err });
    });
}

registerProviderContainerConfig('claude', () => {
  if (!foundryEnv.ANTHROPIC_FOUNDRY_BASE_URL) return {};

  const env: Record<string, string> = {};

  if (proxyPort !== null) {
    // Proxy is ready — point Claude Code at it via host.docker.internal.
    env.ANTHROPIC_BASE_URL = `http://host.docker.internal:${proxyPort}`;
    if (foundryEnv.ANTHROPIC_FOUNDRY_API_KEY) env.ANTHROPIC_API_KEY = foundryEnv.ANTHROPIC_FOUNDRY_API_KEY;
    // Bypass OneCLI's http_proxy for the host proxy — OneCLI runs on a different
    // Docker network and can't route back to the host gateway reliably.
    env.NO_PROXY = 'host.docker.internal';
    env.no_proxy = 'host.docker.internal';
  } else {
    log.warn('Foundry proxy not ready yet — container will use default Anthropic API');
  }

  // Model aliases always pass through regardless of proxy state.
  if (foundryEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = foundryEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  if (foundryEnv.ANTHROPIC_DEFAULT_OPUS_MODEL) env.ANTHROPIC_DEFAULT_OPUS_MODEL = foundryEnv.ANTHROPIC_DEFAULT_OPUS_MODEL;
  if (foundryEnv.ANTHROPIC_DEFAULT_SONNET_MODEL) env.ANTHROPIC_DEFAULT_SONNET_MODEL = foundryEnv.ANTHROPIC_DEFAULT_SONNET_MODEL;

  return { env };
});
