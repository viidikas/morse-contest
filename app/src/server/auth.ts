// Sign-in: the login cookie, and Google's OAuth 2.0 / OpenID Connect flow.
// No passwords are ever handled or stored here; Google confirms who the
// person is and we remember it in a signed cookie.

import * as https from 'node:https';

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'morse_session';
export const STATE_COOKIE = 'morse_oauth_state';

type Sign = (data: string) => string;

/** The value of the login cookie: user id, expiry and a signature over both. */
export function makeSession(userId: string, now: number, sign: Sign): string {
  const body = `${userId}.${Math.floor(now + SESSION_MS)}`;
  return `${body}.${sign(body)}`;
}

/** Returns the user id if the cookie is genuine and not expired. */
export function readSession(value: string, now: number, sign: Sign): string | null {
  const i = value.indexOf('.');
  const j = value.indexOf('.', i + 1);
  if (i < 1 || j < 0) return null;
  const body = value.slice(0, j);
  if (value.slice(j + 1) !== sign(body)) return null;
  if (!(Number(value.slice(i + 1, j)) > now)) return null;
  return value.slice(0, i);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function cookie(name: string, value: string, maxAgeS: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure ? '; Secure' : ''}`;
}

export const SESSION_MAX_AGE_S = SESSION_MS / 1000;

// ---------- Google

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Must match a redirect address registered in Google Cloud Console. */
  redirectUri: string;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

export function googleAuthUrl(cfg: GoogleConfig, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

function postForm(url: string, form: Record<string, string>): Promise<{ status: number; body: string }> {
  const data = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) },
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('google-timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

/**
 * Reads the identity out of the token Google returns. The token arrives
 * directly from Google over HTTPS in exchange for our client secret, which is
 * what makes it trustworthy; the claims are still checked.
 */
export function readIdToken(idToken: string, clientId: string, now: number): GoogleIdentity {
  const payload = idToken.split('.')[1];
  if (!payload) throw new Error('google-bad-token');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  const issuer = String(claims.iss ?? '');
  if (issuer !== 'https://accounts.google.com' && issuer !== 'accounts.google.com') throw new Error('google-bad-issuer');
  if (claims.aud !== clientId) throw new Error('google-bad-audience');
  if (!(Number(claims.exp) * 1000 > now)) throw new Error('google-expired');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('google-email-unverified');
  const sub = String(claims.sub ?? '');
  const email = String(claims.email ?? '');
  if (!sub || !email) throw new Error('google-incomplete');
  return { sub, email, name: String(claims.name ?? claims.given_name ?? '') };
}

/** Swaps the one-time code from the redirect for the person's identity. */
export async function googleIdentity(cfg: GoogleConfig, code: string, now: number): Promise<GoogleIdentity> {
  const res = await postForm('https://oauth2.googleapis.com/token', {
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  });
  if (res.status !== 200) throw new Error('google-exchange-failed');
  const idToken = (JSON.parse(res.body) as { id_token?: string }).id_token;
  if (!idToken) throw new Error('google-no-token');
  return readIdToken(idToken, cfg.clientId, now);
}
