// Room logic tests. Run with: npm test
import { Room, type RoomConfig } from '../server/room.js';
import { Contest } from '../server/contest.js';
import { LEVELS, PASS_ACCURACY, type LevelDef } from '../engine/levels.js';
import { makeRng, coverageGroups } from '../engine/content.js';

declare const process: { exitCode?: number };

let failed = 0;
let passed = 0;
function check(name: string, cond: boolean, detail: string = ''): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}

const cfg: RoomConfig = {
  intervalMs: 120_000, minLobbyMs: 15_000, pauseMs: 2000, groupCount: 5,
  lookaheadMs: 8000, graceMs: 2000, soloLeadMs: 4000,
};
const LEVEL: LevelDef = { id: 'beginner', charCount: 4, charWpm: 20, effWpm: 20, requiresTest: false };
let n = 0;
const makeRoom = () => new Room(LEVEL, cfg, () => `tok${++n}`, () => 7);
const tokenOf = (r: { token: string } | { error: string }): string => ('token' in r ? r.token : '');

// --- scheduling and joining
const room = makeRoom();
const T = 120_000 * 8_400_000; // a moment that is an exact multiple of the interval
check('test clock is on a slot', T % cfg.intervalMs === 0);
const now = T + 10_000;
const a = tokenOf(room.join('  Viljar ', now));
const b = tokenOf(room.join('Mari', now + 500));
const dup = tokenOf(room.join('viljar', now + 600));
check('join returns tokens', !!a && !!b && a !== b);
check('empty name is refused', 'error' in room.join('   ', now));
check('unknown token gets no state', room.state('nope', now, 0) === null);

const st = room.state(a, now + 1000, 0)!;
check('starts on the next slot', st.startAt === T + 120_000, String(st.startAt - T));
check('lobby phase', st.phase === 'lobby');
check('name is trimmed', st.you === 'Viljar');
check('duplicate name gets a number', room.state(dup, now + 1000, 0)!.you === 'viljar 2');
check('three participants listed', st.participants.length === 3);
check('exactly one is you', st.participants.filter((p) => p.you).length === 1);
check('no text released in the lobby', st.groups.length === 0);
check('characters for the level', st.chars === 'KMUR');

// A join too close to a slot goes to the following one.
const late = makeRoom();
const lt = tokenOf(late.join('X', T + 110_000));
check('too close to the slot: next one', late.state(lt, T + 110_000, 0)!.startAt === T + 240_000);
// ...but an existing lobby is joined even in its last seconds.
const lt2 = tokenOf(room.join('Last', T + 119_000));
check('existing lobby is joined late', room.state(lt2, T + 119_000, 0)!.startAt === T + 120_000);

// --- release of text
const start = st.startAt;
const pre = room.state(a, start - 5000, 0)!;
check('first group released shortly before start', pre.groups.length >= 1 && pre.groups[0].index === 0);
check('later groups still withheld', pre.groups.length < 5);
const all = room.state(a, start + st.totalMs - 1, 0)!;
check('all groups released by the end', all.groups.length === 5);
check('from skips known groups', room.state(a, start + st.totalMs - 1, 3)!.groups.length === 2);
check('running phase', all.phase === 'running');
check('finished phase', room.state(a, start + st.totalMs, 0)!.phase === 'finished');

// --- answers
const g = all.groups;
check('answer before the group is refused', room.answer(a, 1, 'KMURK', start + g[1].startMs - 1).reason === 'too-early');
check('answer in the window is accepted', room.answer(a, 0, g[0].text, start + g[0].startMs + 100).ok);
check('answer within grace is accepted', room.answer(a, 1, g[1].text, start + g[1].deadlineMs + 1500).ok);
check('answer after grace is refused', room.answer(a, 2, g[2].text, start + g[2].deadlineMs + 2500).reason === 'too-late');
check('bad index is refused', room.answer(a, 99, 'K', start + 100).reason === 'bad-index');
check('unknown token is refused', room.answer('nope', 0, 'K', start + 100).reason === 'unknown-token');
// Mari copies everything.
g.forEach((slot) => room.answer(b, slot.index, slot.text, start + slot.deadlineMs));

// A participant who joins mid-session.
const mid = tokenOf(room.join('Late', start + g[2].startMs + 10));
check('mid-session join enters the running session', room.state(mid, start + g[2].startMs + 20, 0)!.startAt === start);
check('late joiner cannot answer the group in progress', room.answer(mid, 2, g[2].text, start + g[2].startMs + 50).reason === 'not-joined-yet');
room.answer(mid, 3, g[3].text, start + g[3].deadlineMs);
room.answer(mid, 4, g[4].text, start + g[4].deadlineMs);

// --- results
const end = start + st.totalMs;
check('result not ready during grace', room.result(a, end + 500)!.ready === false);
const res = room.result(a, end + 2500)!;
check('result ready after grace', res.ready);
if (res.ready) {
  check('own scores for every group', res.scores.length === 5);
  check('own correct count', res.scores.reduce((s, x) => s + x.correct, 0) === 10);
  check('board has everyone', res.board.length === 5);
  check('winner is Mari', res.board[0].name === 'Mari' && res.board[0].correct === 25 && res.board[0].rank === 1);
  check('you are marked', res.board.filter((r) => r.you).length === 1 && res.board.find((r) => r.you)!.name === 'Viljar');
  const lateRow = res.board.find((r) => r.name === 'Late')!;
  check('late joiner: points over all groups', lateRow.correct === 10 && lateRow.total === 25);
  check('late joiner: accuracy over attended groups', lateRow.accuracy === 1);
  const zero = res.board.filter((r) => r.correct === 0);
  check('ties share a rank', zero.length === 2 && zero[0].rank === zero[1].rank);
  check('next session is announced', res.nextStartAt === T + 240_000, String(res.nextStartAt - T));
}
const lateRes = room.result(mid, end + 2500)!;
check('late joiner attemptedFrom', lateRes.ready && lateRes.attemptedFrom === 3);

// After the session, a new join goes to the next slot.
const next = tokenOf(room.join('Again', end + 3000));
check('new join after the end gets the next session', room.state(next, end + 3000, 0)!.startAt === T + 240_000);

// --- housekeeping
room.prune(end + 61 * 60_000);
check('old sessions are forgotten', room.state(a, end + 61 * 60_000, 0) === null);

// --- qualification test content
const cov = coverageGroups(makeRng(3), 'KMURESNAPT', 3);
check('coverage: whole groups of five', cov.length === 6 && cov.every((x) => x.length === 5));
check('coverage: every character three times', [...'KMURESNAPT'].every((ch) => cov.join('').split(ch).length - 1 === 3));
const padded = coverageGroups(makeRng(3), 'KMU', 3).join('');
check('coverage: padded to whole groups', padded.length === 10 && [...'KMU'].every((ch) => padded.split(ch).length - 1 >= 3));

// --- levels and qualification
const contest = new Contest(cfg, () => `c${++n}`, () => 11, (data) => `sig(${data})`);
const t0 = T + 5000;
const info = contest.levels(t0);
check('three levels listed', info.levels.length === 3 && info.levels[0].id === 'beginner');
check('levels share the start time', info.levels.every((l) => l.startAt === info.levels[0].startAt));
check('beginner is open to everyone', 'token' in contest.join('beginner', 'Ann', '', t0));
check('mid is locked without a pass', (contest.join('mid', 'Ann', '', t0) as { error: string }).error === 'not-qualified');
check('unknown level is refused', (contest.join('nope', 'Ann', '', t0) as { error: string }).error === 'unknown-level');
check('no test for beginner', 'error' in contest.qualify('beginner', t0));

const midLevel = LEVELS.find((l) => l.id === 'mid')!;
function runTest(copyShare: number): { passed?: boolean; pass?: string } {
  const tok = tokenOf(contest.qualify('mid', t0));
  const first = contest.state(tok, t0, 0)!;
  const endAt = first.startAt + first.totalMs;
  const every = contest.state(tok, endAt - 1, 0)!.groups;
  every.forEach((slot, i) => {
    if (i < Math.round(every.length * copyShare)) contest.answer(tok, slot.index, slot.text, first.startAt + slot.deadlineMs);
  });
  check('test is private', first.solo && first.participants.length === 1);
  check('test starts a few seconds after asking', first.startAt === t0 + cfg.soloLeadMs);
  check('test covers every character five times',
    [...first.chars].every((ch) => every.map((x) => x.text).join('').split(ch).length - 1 === 5));
  check('test uses the level characters', first.chars.length === midLevel.charCount);
  return contest.result(tok, endAt + cfg.graceMs) as { passed?: boolean; pass?: string };
}
const fail = runTest(PASS_ACCURACY - 0.1);
check('below the threshold fails', fail.passed === false && fail.pass === undefined);
const ok = runTest(PASS_ACCURACY + 0.05);
check('above the threshold passes', ok.passed === true && typeof ok.pass === 'string');
const pass = ok.pass ?? '';
const opened = contest.join('mid', 'Ann', pass, t0);
check('pass opens mid', 'token' in opened, JSON.stringify(opened) + ' pass=' + pass);
check('mid pass does not open advanced', 'error' in contest.join('advanced', 'Ann', pass, t0));
check('advanced pass opens mid', contest.passAllows(contest.makePass('advanced', t0), 'mid', t0));
check('tampered pass is refused', 'error' in contest.join('mid', 'Ann', pass.replace('mid', 'advanced'), t0));
check('forged signature is refused', 'error' in contest.join('mid', 'Ann', pass.slice(0, -2) + 'xx', t0));
check('expired pass is refused', !contest.passAllows(pass, 'mid', t0 + 181 * 24 * 3600 * 1000));
check('garbage pass is refused', !contest.passAllows('hello', 'mid', t0) && !contest.passAllows('', 'mid', t0));
const midTok = tokenOf(contest.join('mid', 'Bob', pass, t0));
check('state is routed to the right room', contest.state(midTok, t0, 0)!.level === 'mid');
check('shared session is not solo', contest.state(midTok, t0, 0)!.solo === false);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
