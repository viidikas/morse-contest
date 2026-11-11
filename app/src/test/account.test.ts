// Tests for accounts, saved results and the login cookie. Run with: npm test
import { Store, cleanName, type ResultRow, type StoreData } from '../server/store.js';
import { cookie, googleAuthUrl, makeSession, parseCookies, readIdToken, readSession } from '../server/auth.js';

declare const process: { exitCode?: number };
declare const Buffer: { from(s: string): { toString(enc: string): string } };

let failed = 0;
let passed = 0;
function check(name: string, cond: boolean, detail: string = ''): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}
function throws(fn: () => unknown): boolean {
  try { fn(); return false; } catch { return true; }
}

// ---------- store
let saved = '';
let ids = 0;
const store = new Store(null, (json) => { saved = json; }, () => `id${++ids}`);
const admins = new Set(['boss@example.com']);
const now = 1_700_000_000_000;

const ann = store.signIn({ sub: 'g-1', email: 'Ann@Example.com', name: '  Ann Example  ' }, now, admins);
check('first sign-in creates an account', ann.id === 'id1' && ann.role === 'user' && !ann.blocked && ann.level === null);
check('email is stored in lower case', ann.email === 'ann@example.com');
check('name is trimmed', ann.name === 'Ann Example');
check('changes are written out', saved.includes('ann@example.com'));
const again = store.signIn({ sub: 'g-1', email: 'ann@example.com', name: 'Different' }, now + 5000, admins);
check('signing in again finds the same account', again.id === ann.id && store.allUsers().length === 1);
check('chosen name is kept on later sign-ins', again.name === 'Ann Example');
check('last sign-in time is updated', again.lastSeenAt === now + 5000);
const boss = store.signIn({ sub: 'g-2', email: 'boss@example.com', name: 'Boss' }, now, admins);
check('listed email becomes administrator', boss.role === 'admin');
check('nameless account falls back to the email', store.signIn({ sub: 'g-3', email: 'kai@example.com', name: '' }, now, admins).name === 'kai');
check('cleanName limits length', cleanName('x'.repeat(50)).length === 20);
check('cleanName drops control characters', cleanName('a\u0007b') === 'ab');

check('rename works', 'name' in store.rename(ann.id, ' ES1ANN ') && store.user(ann.id)!.name === 'ES1ANN');
check('empty name is refused', 'error' in store.rename(ann.id, '   '));
check('unknown user cannot be renamed', 'error' in store.rename('nope', 'x'));

store.grantLevel(ann.id, 'mid');
check('passing a test raises the level', store.user(ann.id)!.level === 'mid');
store.grantLevel(ann.id, 'mid');
store.grantLevel(ann.id, 'beginner');
check('a lower result never lowers the level', store.user(ann.id)!.level === 'mid');
store.grantLevel(ann.id, 'advanced');
check('a harder test raises it further', store.user(ann.id)!.level === 'advanced');
check('administrator can set the level', store.setLevel(ann.id, 'mid') && store.user(ann.id)!.level === 'mid');
check('administrator can remove the level', store.setLevel(ann.id, null) && store.user(ann.id)!.level === null);
check('unknown level is refused', !store.setLevel(ann.id, 'wizard'));

check('block and unblock', store.setBlocked(ann.id, true) && store.user(ann.id)!.blocked && store.setBlocked(ann.id, false) && !store.user(ann.id)!.blocked);
check('role can be changed', store.setRole(ann.id, 'admin') && store.user(ann.id)!.role === 'admin' && store.setRole(ann.id, 'user'));

const row = (userId: string, over: Partial<ResultRow>): Omit<ResultRow, 'id'> => ({
  userId, kind: 'contest', level: 'beginner', startAt: now, correct: 40, total: 50, accuracy: 0.8,
  rank: 2, people: 3, passed: null, chars: { K: [5, 4] }, ...over,
});
store.addResults([
  row(ann.id, { startAt: now + 1000 }),
  row(ann.id, { startAt: now + 2000, accuracy: 1, correct: 50, rank: 1 }),
  row(ann.id, { startAt: now + 3000, kind: 'test', level: 'mid', rank: null, people: 1, passed: true }),
  row(boss.id, { rank: 1, people: 1 }),
  row('ghost', {}),
]);
const mine = store.resultsOf(ann.id);
check('results are saved per account', mine.length === 3 && store.resultsOf(boss.id).length === 1);
check('newest result first', mine[0].startAt === now + 3000);
check('results for unknown accounts are dropped', !saved.includes('ghost'));
const stats = store.statsOf(ann.id);
check('stats count sessions and tests separately', stats.sessions === 2 && stats.tests === 1);
check('average and best accuracy', Math.abs(stats.averageAccuracy! - 0.9) < 1e-9 && stats.bestAccuracy === 1);
check('a win needs opponents', stats.wins === 1 && store.statsOf(boss.id).wins === 0);
check('no results gives empty stats', store.statsOf('id3').averageAccuracy === null);

// Reloading from what was written gives the same data back.
const reloaded = new Store(JSON.parse(saved) as StoreData, () => undefined, () => 'x');
check('data survives a restart', reloaded.allUsers().length === 3 && reloaded.resultsOf(ann.id).length === 3);
check('same Google identity is recognised after a restart',
  reloaded.signIn({ sub: 'g-1', email: 'ann@example.com', name: 'A' }, now, admins).id === ann.id);

check('deleting removes the account and its results', store.deleteUser(ann.id) && !store.user(ann.id) && store.resultsOf(ann.id).length === 0);
check('other accounts are untouched', store.resultsOf(boss.id).length === 1);
check('deleting twice reports failure', !store.deleteUser(ann.id));

// ---------- login cookie
const sign = (data: string): string => `sig<${data.length}:${data}>`;
const session = makeSession('user-1', now, sign);
check('session cookie is read back', readSession(session, now + 1000, sign) === 'user-1');
check('session expires after 30 days', readSession(session, now + 31 * 24 * 3600 * 1000, sign) === null);
check('changed user id is refused', readSession(session.replace('user-1', 'user-2'), now, sign) === null);
check('another signing key is refused', readSession(session, now, (d) => `other${d}`) === null);
check('garbage is refused', readSession('', now, sign) === null && readSession('abc', now, sign) === null && readSession('a.b', now, sign) === null);

const parsed = parseCookies('a=1; morse_session=x%2Ey; b = 2 ');
check('cookies are parsed', parsed.a === '1' && parsed.morse_session === 'x.y' && parsed.b === '2');
check('no cookie header is fine', Object.keys(parseCookies(undefined)).length === 0);
const set = cookie('n', 'v w', 60, true);
check('cookie is HttpOnly, Lax and Secure', set.includes('HttpOnly') && set.includes('SameSite=Lax') && set.endsWith('; Secure') && set.startsWith('n=v%20w;'));
check('no Secure flag on plain http', !cookie('n', 'v', 60, false).includes('Secure'));

// ---------- Google
const url = new URL(googleAuthUrl({ clientId: 'cid', clientSecret: 's', redirectUri: 'https://x.test/auth/google/callback' }, 'st8'));
check('Google address carries our settings',
  url.hostname === 'accounts.google.com' && url.searchParams.get('client_id') === 'cid' &&
  url.searchParams.get('redirect_uri') === 'https://x.test/auth/google/callback' &&
  url.searchParams.get('state') === 'st8' && url.searchParams.get('scope') === 'openid email profile');
check('the client secret is never put in the address', !url.toString().includes('clientSecret') && url.searchParams.get('client_secret') === null);

const token = (claims: Record<string, unknown>): string =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const good = { iss: 'https://accounts.google.com', aud: 'cid', exp: now / 1000 + 600, email_verified: true, sub: '123', email: 'a@b.c', name: 'A B' };
const id = readIdToken(token(good), 'cid', now);
check('identity is read from the token', id.sub === '123' && id.email === 'a@b.c' && id.name === 'A B');
check('token for another app is refused', throws(() => readIdToken(token({ ...good, aud: 'other' }), 'cid', now)));
check('token from another issuer is refused', throws(() => readIdToken(token({ ...good, iss: 'https://evil.test' }), 'cid', now)));
check('expired token is refused', throws(() => readIdToken(token({ ...good, exp: now / 1000 - 1 }), 'cid', now)));
check('unverified email is refused', throws(() => readIdToken(token({ ...good, email_verified: false }), 'cid', now)));
check('token without identity is refused', throws(() => readIdToken(token({ ...good, sub: '' }), 'cid', now)));
check('malformed token is refused', throws(() => readIdToken('nonsense', 'cid', now)));

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
