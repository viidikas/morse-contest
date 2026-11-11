// HTTP server: the JSON API for a room plus the static browser files.
// Plain HTTPS-style request/response only, because the hosting does not pass
// WebSockets through.

import * as http from 'node:http';
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contest } from './contest.js';
import type { RoomConfig } from './room.js';

const env = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== '' ? v : fallback;
};

// Defaults are short practice sessions every 2 minutes, convenient for
// development. Real sessions are configured through the environment.
const config: RoomConfig = {
  intervalMs: env('SESSION_EVERY_MIN', 2) * 60_000,
  minLobbyMs: env('MIN_LOBBY_S', 15) * 1000,
  pauseMs: env('PAUSE_S', 2.5) * 1000,
  groupCount: env('SESSION_GROUPS', 10), // not GROUPS: that name is reserved in bash
  lookaheadMs: 8000,
  graceMs: 2000,
  soloLeadMs: 4000,
};

// Qualification passes are signed with this secret. Without PASS_SECRET a
// random one is used, and passes stop being valid when the server restarts.
const secret = process.env.PASS_SECRET || randomBytes(32).toString('hex');
if (!process.env.PASS_SECRET) console.log('PASS_SECRET is not set: qualification passes last until restart.');

const contest = new Contest(
  config,
  () => randomBytes(24).toString('base64url'),
  () => randomInt(0, 2 ** 32),
  (data) => createHmac('sha256', secret).update(data).digest('base64url'),
);
setInterval(() => contest.prune(Date.now()), 10 * 60_000).unref();

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Only browser code is served. Server code under dist/server stays private.
const PUBLIC_PREFIXES = ['/web/', '/dist/web/', '/dist/engine/'];
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 4096) {
        reject(new Error('too-large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolve(data && typeof data === 'object' ? (data as Record<string, unknown>) : {});
      } catch {
        reject(new Error('bad-json'));
      }
    });
    req.on('error', reject);
  });
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const now = Date.now();
  const token = String(req.headers['x-token'] ?? '');
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/time') return sendJson(res, 200, { now });

  if (route === 'GET /api/levels') return sendJson(res, 200, contest.levels(now));

  if (route === 'POST /api/join') {
    const body = await readBody(req);
    const out = contest.join(String(body.level ?? ''), String(body.name ?? ''), String(body.pass ?? ''), now);
    return sendJson(res, 'error' in out ? 400 : 200, out);
  }
  if (route === 'POST /api/qualify') {
    const body = await readBody(req);
    const out = contest.qualify(String(body.level ?? ''), now);
    return sendJson(res, 'error' in out ? 400 : 200, out);
  }
  if (route === 'GET /api/state') {
    const state = contest.state(token, now, Number(url.searchParams.get('from') ?? 0));
    return state ? sendJson(res, 200, state) : sendJson(res, 401, { error: 'unknown-token' });
  }
  if (route === 'POST /api/answer') {
    const body = await readBody(req);
    return sendJson(res, 200, contest.answer(token, Number(body.index), String(body.text ?? ''), now));
  }
  if (route === 'GET /api/result') {
    const result = contest.result(token, now);
    return result ? sendJson(res, 200, result) : sendJson(res, 401, { error: 'unknown-token' });
  }
  return sendJson(res, 404, { error: 'not-found' });
}

async function staticFile(res: http.ServerResponse, pathname: string): Promise<void> {
  let path = decodeURIComponent(pathname);
  // The web server in front may ask for /index.html when the visitor asked for /.
  if (path === '/' || path === '/index.html') {
    res.writeHead(302, { Location: '/web/contest.html' });
    res.end();
    return;
  }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(appRoot, path));
  const allowed = PUBLIC_PREFIXES.some((p) => path.startsWith(p)) && file.startsWith(appRoot + sep);
  const type = TYPES[extname(file)];
  if (!allowed || !type) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const work = url.pathname.startsWith('/api/') ? api(req, res, url) : staticFile(res, url.pathname);
  work.catch((err: Error) => {
    if (!res.headersSent) sendJson(res, err.message === 'too-large' ? 413 : 400, { error: err.message });
    else res.end();
  });
});

const port = env('PORT', 5180);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => {
  console.log(`Morse contest: http://localhost:${port}/`);
});
