// HTTP server: sign-in, the JSON API and the static browser files.
// Plain request/response only, because the hosting does not pass WebSockets.

import * as http from 'node:http';
import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contest, type Player } from './contest.js';
import type { RoomConfig } from './room.js';
import { Store, type StoreData, type User } from './store.js';
import {
  SESSION_COOKIE, SESSION_MAX_AGE_S, STATE_COOKIE, cookie, googleAuthUrl, googleIdentity,
  makeSession, parseCookies, readSession, type GoogleConfig,
} from './auth.js';

// ---------- settings (from the environment; see deploy/start.sh)

const text = (name: string): string => process.env[name] ?? '';
const num = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return text(name) !== '' && Number.isFinite(v) ? v : fallback;
};

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Defaults are short practice sessions every 2 minutes, convenient for
// development. Real sessions are configured through the environment.
const config: RoomConfig = {
  intervalMs: num('SESSION_EVERY_MIN', 2) * 60_000,
  minLobbyMs: num('MIN_LOBBY_S', 15) * 1000,
  pauseMs: num('PAUSE_S', 2.5) * 1000,
  groupCount: num('SESSION_GROUPS', 10), // not GROUPS: that name is reserved in bash
  lookaheadMs: 8000,
  graceMs: 2000,
  soloLeadMs: 4000,
};

/** Public address of the site, e.g. https://morse.viljar.ee. Empty when run locally. */
const baseUrl = text('BASE_URL').replace(/\/+$/, '');
const secure = baseUrl.startsWith('https://');
const google: GoogleConfig | null =
  text('GOOGLE_CLIENT_ID') && text('GOOGLE_CLIENT_SECRET')
    ? {
        clientId: text('GOOGLE_CLIENT_ID'),
        clientSecret: text('GOOGLE_CLIENT_SECRET'),
        redirectUri: `${baseUrl || `http://localhost:${num('PORT', 5180)}`}/auth/google/callback`,
      }
    : null;
/** A name-only login for development. Never available on a public address. */
const devLogin = !google && !baseUrl;
const adminEmails = new Set(text('ADMIN_EMAILS').toLowerCase().split(/[\s,]+/).filter(Boolean));

// Login cookies are signed with this secret. Without APP_SECRET a random one
// is used and everyone is signed out when the server restarts.
const secret = text('APP_SECRET') || text('PASS_SECRET') || randomBytes(32).toString('hex');
if (!text('APP_SECRET') && !text('PASS_SECRET')) console.log('APP_SECRET is not set: logins last until restart.');
const sign = (data: string): string => createHmac('sha256', secret).update(data).digest('base64url');

// ---------- data

const dataFile = text('DATA_FILE') || join(appRoot, '..', 'data', 'store.json');
mkdirSync(dirname(dataFile), { recursive: true });
let pending: string | null = null;
function flushToDisk(): void {
  if (pending === null) return;
  const json = pending;
  pending = null;
  // Write to a temporary file first so a crash cannot leave a half-written file.
  writeFileSync(`${dataFile}.tmp`, json);
  renameSync(`${dataFile}.tmp`, dataFile);
}
const store = new Store(
  existsSync(dataFile) ? (JSON.parse(readFileSync(dataFile, 'utf8')) as StoreData) : null,
  (json) => {
    if (pending === null) setTimeout(flushToDisk, 200);
    pending = json;
  },
  () => randomUUID(),
);
process.on('SIGTERM', () => { flushToDisk(); process.exit(0); });
process.on('SIGINT', () => { flushToDisk(); process.exit(0); });

const contest = new Contest(
  config,
  () => randomBytes(24).toString('base64url'),
  () => randomInt(0, 2 ** 32),
);

/** Saves the results of sessions that have just ended and records passed tests. */
function saveFinished(now: number): void {
  for (const s of contest.collectFinished(now)) {
    store.addResults(
      s.rows.map((r) => ({
        userId: r.userId,
        kind: s.solo ? ('test' as const) : ('contest' as const),
        level: s.level,
        startAt: s.startAt,
        correct: r.correct,
        total: r.total,
        accuracy: r.accuracy,
        rank: s.solo ? null : r.rank,
        people: s.people,
        passed: s.passed,
        chars: r.chars,
      })),
    );
    if (s.solo && s.passed && s.rows[0]) store.grantLevel(s.rows[0].userId, s.level);
  }
}
setInterval(() => saveFinished(Date.now()), 3000).unref();
setInterval(() => contest.prune(Date.now()), 10 * 60_000).unref();

// ---------- helpers

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

function redirect(res: http.ServerResponse, to: string, cookies: string[] = []): void {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
  res.end();
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

function currentUser(req: http.IncomingMessage, now: number): User | null {
  const value = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const id = value ? readSession(value, now, sign) : null;
  return (id && store.user(id)) || null;
}

/** What the browser may know about an account. */
const publicUser = (u: User) => ({ id: u.id, name: u.name, email: u.email, role: u.role, level: u.level });
const asPlayer = (u: User): Player => ({ id: u.id, name: u.name, level: u.level });
const home = `${baseUrl}/web/contest.html`;

// ---------- sign-in routes

async function auth(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const now = Date.now();
  const route = `${req.method} ${url.pathname}`;
  const loggedIn = (user: User): void =>
    redirect(res, home, [
      cookie(SESSION_COOKIE, makeSession(user.id, now, sign), SESSION_MAX_AGE_S, secure),
      cookie(STATE_COOKIE, '', 0, secure),
    ]);

  if (route === 'GET /auth/google') {
    if (!google) return redirect(res, `${home}?login=unavailable`);
    const state = randomBytes(16).toString('base64url');
    return redirect(res, googleAuthUrl(google, state), [cookie(STATE_COOKIE, state, 600, secure)]);
  }

  if (route === 'GET /auth/google/callback') {
    if (!google) return redirect(res, `${home}?login=unavailable`);
    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code') ?? '';
    // The state must match the one we set before sending the person to Google.
    if (!code || !state || state !== parseCookies(req.headers.cookie)[STATE_COOKIE]) {
      return redirect(res, `${home}?login=failed`);
    }
    try {
      return loggedIn(store.signIn(await googleIdentity(google, code, now), now, adminEmails));
    } catch (err) {
      console.log(`Google sign-in failed: ${(err as Error).message}`);
      return redirect(res, `${home}?login=failed`);
    }
  }

  if (route === 'POST /auth/dev' && devLogin) {
    const body = await readBody(req);
    const name = String(body.name ?? '').trim().slice(0, 20);
    if (!name) return sendJson(res, 400, { error: 'name-required' });
    const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@dev.local`;
    const user = store.signIn({ sub: `dev:${email}`, email, name }, now, adminEmails);
    // Locally, the first account becomes the administrator so the admin page can be tried.
    if (store.allUsers().length === 1) store.setRole(user.id, 'admin');
    res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, makeSession(user.id, now, sign), SESSION_MAX_AGE_S, secure));
    return sendJson(res, 200, { ok: true });
  }

  if (route === 'POST /auth/logout') {
    res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0, secure));
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'not-found' });
}

// ---------- API

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const now = Date.now();
  const token = String(req.headers['x-token'] ?? '');
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/time') return sendJson(res, 200, { now });

  const me = currentUser(req, now);
  if (route === 'GET /api/me') {
    return sendJson(res, 200, { user: me ? publicUser(me) : null, google: !!google, devLogin });
  }
  if (!me) return sendJson(res, 401, { error: 'login-required' });
  if (me.blocked) return sendJson(res, 403, { error: 'blocked' });

  // ----- own account
  if (route === 'POST /api/me') {
    const out = store.rename(me.id, String((await readBody(req)).name ?? ''));
    return 'error' in out ? sendJson(res, 400, out) : sendJson(res, 200, { user: publicUser(out) });
  }
  if (route === 'GET /api/my/results') {
    saveFinished(now);
    return sendJson(res, 200, { results: store.resultsOf(me.id), stats: store.statsOf(me.id) });
  }

  // ----- rooms and sessions
  if (route === 'GET /api/levels') return sendJson(res, 200, contest.levels(now, me.level));
  if (route === 'POST /api/join') {
    const out = contest.join(String((await readBody(req)).level ?? ''), asPlayer(me), now);
    return sendJson(res, 'error' in out ? 400 : 200, out);
  }
  if (route === 'POST /api/qualify') {
    const out = contest.qualify(String((await readBody(req)).level ?? ''), asPlayer(me), now);
    return sendJson(res, 'error' in out ? 400 : 200, out);
  }
  if (route === 'GET /api/state') {
    const state = contest.state(token, now, Number(url.searchParams.get('from') ?? 0));
    return state ? sendJson(res, 200, state) : sendJson(res, 410, { error: 'unknown-token' });
  }
  if (route === 'POST /api/answer') {
    const body = await readBody(req);
    return sendJson(res, 200, contest.answer(token, Number(body.index), String(body.text ?? ''), now));
  }
  if (route === 'GET /api/result') {
    const result = contest.result(token, now);
    // Save before answering, so the account already shows it when the page asks.
    if (result?.ready) saveFinished(now);
    return result ? sendJson(res, 200, result) : sendJson(res, 410, { error: 'unknown-token' });
  }

  // ----- administration
  if (url.pathname.startsWith('/api/admin/')) {
    if (me.role !== 'admin') return sendJson(res, 403, { error: 'admin-only' });

    if (route === 'GET /api/admin/users') {
      saveFinished(now);
      return sendJson(res, 200, {
        users: store.allUsers().map((u) => ({
          ...publicUser(u), blocked: u.blocked, createdAt: u.createdAt, lastSeenAt: u.lastSeenAt,
          stats: store.statsOf(u.id), you: u.id === me.id,
          // Administrators named in the server settings cannot be demoted from the page.
          fixedAdmin: adminEmails.has(u.email),
        })),
      });
    }
    const match = /^\/api\/admin\/users\/([^/]+)(\/results)?$/.exec(url.pathname);
    const target = match ? store.user(decodeURIComponent(match[1])) : undefined;
    if (!match || !target) return sendJson(res, 404, { error: 'unknown-user' });

    if (req.method === 'GET' && match[2]) {
      return sendJson(res, 200, { results: store.resultsOf(target.id), stats: store.statsOf(target.id) });
    }
    if (req.method === 'POST' && !match[2]) {
      const body = await readBody(req);
      const self = target.id === me.id;
      if (typeof body.name === 'string') {
        const out = store.rename(target.id, body.name);
        if ('error' in out) return sendJson(res, 400, out);
      }
      if (typeof body.blocked === 'boolean') {
        if (self) return sendJson(res, 400, { error: 'not-yourself' });
        store.setBlocked(target.id, body.blocked);
      }
      if (body.role === 'admin' || body.role === 'user') {
        if (self || adminEmails.has(target.email)) return sendJson(res, 400, { error: 'not-yourself' });
        store.setRole(target.id, body.role);
      }
      if (body.level === null || typeof body.level === 'string') {
        if (!store.setLevel(target.id, body.level || null)) return sendJson(res, 400, { error: 'unknown-level' });
      }
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && !match[2]) {
      if (target.id === me.id) return sendJson(res, 400, { error: 'not-yourself' });
      store.deleteUser(target.id);
      return sendJson(res, 200, { ok: true });
    }
  }
  return sendJson(res, 404, { error: 'not-found' });
}

// ---------- static files

async function staticFile(res: http.ServerResponse, pathname: string): Promise<void> {
  let path = decodeURIComponent(pathname);
  // The web server in front may ask for /index.html when the visitor asked for /.
  if (path === '/' || path === '/index.html') return redirect(res, '/web/home.html');
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

// ---------- server

/**
 * A request that changes something must come from our own pages. Browsers
 * state where such a request originates; anything from another site is refused.
 */
function foreignOrigin(req: http.IncomingMessage): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return false;
  const origin = req.headers.origin;
  if (!origin) return false;
  const expected = baseUrl || `http://${req.headers.host ?? ''}`;
  return origin !== expected;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let work: Promise<void>;
  if (foreignOrigin(req)) work = Promise.resolve(sendJson(res, 403, { error: 'foreign-origin' }));
  else if (url.pathname.startsWith('/api/')) work = api(req, res, url);
  else if (url.pathname.startsWith('/auth/')) work = auth(req, res, url);
  else work = staticFile(res, url.pathname);
  work.catch((err: Error) => {
    if (!res.headersSent) sendJson(res, err.message === 'too-large' ? 413 : 400, { error: err.message });
    else res.end();
  });
});

const port = num('PORT', 5180);
const host = text('HOST') || '127.0.0.1';
server.listen(port, host, () => {
  console.log(`Morse contest: http://localhost:${port}/`);
  console.log(`Sign-in: ${google ? 'Google' : devLogin ? 'development login (name only)' : 'NOT CONFIGURED'}; data: ${dataFile}`);
});
