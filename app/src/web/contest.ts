// Contest page: choose a room, wait in the lobby, copy the shared feed in
// sync with everyone else, then see the scoreboard. The same run loop also
// drives the solo qualification test that unlocks the harder rooms.

import { makeTiming, buildTimeline, type Timing } from '../engine/morse.js';
import type { GroupScore } from '../engine/score.js';
import { levelRank } from '../engine/levels.js';
import { MorsePlayer } from './player.js';
import { initChart } from './chart.js';
import { t, type Key, type Lang } from './i18n.js';
import { $, el, formatDuration, renderResult } from './results.js';

// ---------- shapes of the server's answers (see server/room.ts and contest.ts)

interface Slot { index: number; text: string; startMs: number; deadlineMs: number }
interface State {
  now: number;
  phase: 'lobby' | 'running' | 'finished';
  level: string;
  solo: boolean;
  startAt: number;
  totalMs: number;
  groupCount: number;
  charWpm: number;
  effWpm: number;
  chars: string;
  you: string;
  participants: { name: string; online: boolean; you: boolean }[];
  groups: Slot[];
}
interface BoardRow { rank: number; name: string; correct: number; total: number; accuracy: number; you: boolean }
interface ReadyResult {
  ready: true;
  level: string;
  solo: boolean;
  scores: GroupScore[];
  attemptedFrom: number;
  accuracy: number;
  board: BoardRow[];
  nextStartAt: number;
  passed?: boolean;
  threshold?: number;
  pass?: string;
}
type Result = { ready: false } | ReadyResult;
interface LevelInfo {
  id: string;
  chars: string;
  charWpm: number;
  effWpm: number;
  requiresTest: boolean;
  startAt: number;
  running: boolean;
  people: number;
}
interface Levels { now: number; passAccuracy: number; levels: LevelInfo[] }

// ---------- small persistent preferences

interface Prefs { lang: Lang; name: string; pitch: number; volume: number; passes: Record<string, string> }
const PREFS_KEY = 'morse-contest-prefs';
const TOKEN_KEY = 'morse-contest-token'; // per tab, so two tabs are two participants

function loadPrefs(): Prefs {
  const base: Prefs = {
    lang: navigator.language.toLowerCase().startsWith('et') ? 'et' : 'en',
    name: '', pitch: 600, volume: 0.5, passes: {},
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch { /* storage unavailable */ }
  return base;
}
function savePrefs(): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}
function getToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return memoryToken; }
}
function setToken(value: string): void {
  memoryToken = value;
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

let memoryToken = '';
const prefs = loadPrefs();
const player = new MorsePlayer();
const chart = initChart();

/** The stored pass that opens a room: one for that level or for a harder one. */
function passFor(levelId: string): string {
  const best = Object.keys(prefs.passes)
    .filter((id) => levelRank(id) >= levelRank(levelId))
    .sort((a, b) => levelRank(b) - levelRank(a))[0];
  return best ? prefs.passes[best] : '';
}

// ---------- server clock

// Local time that cannot jump when the computer's clock is adjusted.
const localNow = (): number => performance.timeOrigin + performance.now();
let clockOffset = 0;
let bestRtt = Infinity;
const serverNow = (): number => localNow() + clockOffset;

/** Every answer from the server carries its time; the fastest round trip gives the best estimate. */
function noteServerTime(sentAt: number, receivedAt: number, serverTime: number): void {
  const rtt = receivedAt - sentAt;
  if (rtt <= bestRtt * 1.2) {
    bestRtt = Math.min(bestRtt, rtt);
    clockOffset = serverTime - (sentAt + rtt / 2);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const sentAt = localNow();
  const res = await fetch(`../api/${path}`, {
    method,
    cache: 'no-store',
    headers: { 'X-Token': getToken(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as T & { now?: number };
  if (typeof data.now === 'number') noteServerTime(sentAt, localNow(), data.now);
  return { status: res.status, data };
}

async function syncClock(): Promise<void> {
  for (let i = 0; i < 5; i++) await call('GET', 'time');
}

// ---------- views and language

const views = {
  join: $('view-join'), lobby: $('view-lobby'), run: $('view-run'),
  wait: $('view-wait'), result: $('view-result'),
};
type View = keyof typeof views;
let view: View = 'join';
function show(next: View): void {
  view = next;
  for (const [name, node] of Object.entries(views)) node.hidden = name !== next;
  updateSoundWarning();
}

const LEVEL_NAME: Record<string, Key> = {
  beginner: 'levelBeginner', mid: 'levelMid', advanced: 'levelAdvanced',
};
const levelName = (id: string): string => (LEVEL_NAME[id] ? t(LEVEL_NAME[id], prefs.lang) : id);
const fill = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

function applyLanguage(): void {
  document.documentElement.lang = prefs.lang;
  document.querySelectorAll<HTMLElement>('[data-t]').forEach((node) => {
    node.textContent = t(node.dataset.t as Key, prefs.lang);
  });
  $<HTMLInputElement>('answer').placeholder = t('typeHere', prefs.lang);
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === prefs.lang));
  });
  document.title = t('contestTitle', prefs.lang);
  chart.setLabels(t('chartTitle', prefs.lang), t('chartShow', prefs.lang), t('chartHide', prefs.lang));
  if (lastLevels) renderLevels(lastLevels);
  if (lastState) renderLobby(lastState);
  if (lastResult) renderBoard(lastResult);
}

const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString(prefs.lang === 'et' ? 'et-EE' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

function updateSoundWarning(): void {
  $('sound-off').hidden = player.isReady || view === 'join' || view === 'result' || view === 'wait';
}

// ---------- choosing a room

let lastLevels: Levels | null = null;
let levelsTimer: number | undefined;

async function loadLevels(): Promise<void> {
  window.clearTimeout(levelsTimer);
  if (view !== 'join') return;
  try {
    const { data } = await call<Levels>('GET', 'levels');
    $('net-error').hidden = true;
    // Redraw only when something changed, so buttons keep keyboard focus.
    const changed = JSON.stringify(data.levels) !== JSON.stringify(lastLevels?.levels);
    lastLevels = data;
    if (changed) renderLevels(data);
  } catch {
    $('net-error').hidden = false;
  }
  levelsTimer = window.setTimeout(() => void loadLevels(), 5000);
}

function renderLevels(data: Levels): void {
  const lang = prefs.lang;
  const box = $('levels');
  box.replaceChildren();
  for (const level of data.levels) {
    const open = !level.requiresTest || passFor(level.id) !== '';
    const card = el('div', open ? 'level' : 'level locked', '');
    card.append(
      el('h3', '', levelName(level.id)),
      el('div', 'meta', `${level.chars.length} ${t('characters', lang)} · ${level.charWpm} / ${level.effWpm} WPM`),
      el('div', 'level-chars mono', [...level.chars].join(' ')),
      el('div', 'meta',
        `${level.running ? t('runningNow', lang) : `${t('nextStart', lang)} ${clock(level.startAt)}`}` +
        ` · ${level.people} ${t('inRoomCount', lang)}`),
    );

    let rule: string;
    if (!level.requiresTest) rule = t('openToAll', lang);
    else if (open) rule = t('qualified', lang);
    else rule = fill(t('locked', lang), { n: level.chars.length, p: Math.round(data.passAccuracy * 100) });
    card.append(el('p', 'rule', rule));

    const actions = el('div', 'actions', '');
    if (open) {
      const join = el('button', 'primary', `${t('join', lang)}: ${levelName(level.id)}`) as HTMLButtonElement;
      join.type = 'button';
      join.addEventListener('click', () => void joinLevel(level.id));
      actions.append(join);
    }
    if (level.requiresTest) {
      const test = el('button', open ? 'secondary' : 'primary', t(open ? 'retakeTest' : 'takeTest', lang)) as HTMLButtonElement;
      test.type = 'button';
      test.addEventListener('click', () => void startTest(level.id));
      actions.append(test);
    }
    card.append(actions);
    box.append(card);
  }
}

function joinError(key: Key | null): void {
  const node = $('join-error');
  node.hidden = key === null;
  if (key) node.textContent = t(key, prefs.lang);
}

// ---------- session state

let lastState: State | null = null;
let lastResult: ReadyResult | null = null;
let slots: Slot[] = []; // groups received so far, by index
let scheduled = 0; // number of groups already handed to the audio player
let current = -1; // index of the group now being sent
let timing: Timing | null = null;
let joinedLate = false;
let lastLevelId = 'beginner';
let pollTimer: number | undefined;
let tickTimer: number | undefined;

function reset(): void {
  window.clearTimeout(pollTimer);
  window.clearInterval(tickTimer);
  player.stop();
  lastState = null;
  slots = [];
  scheduled = 0;
  current = -1;
  timing = null;
  joinedLate = false;
}

function toJoin(): void {
  reset();
  lastResult = null;
  setToken('');
  document.body.dataset.mode = 'contest';
  chart.setActive(null);
  $<HTMLInputElement>('name').value = prefs.name;
  show('join');
  if (lastLevels) renderLevels(lastLevels); // a newly earned pass may have unlocked a room
  void loadLevels();
}

async function poll(): Promise<void> {
  let delay = 1000;
  try {
    const { status, data } = await call<State>('GET', `state?from=${slots.length}`);
    $('net-error').hidden = true;
    if (status === 401) return toJoin(); // server restarted or session expired
    onState(data);
    if (data.phase === 'finished') return; // the tick loop takes it from here
    // In the lobby a slow poll is enough until the start is near.
    if (data.phase === 'lobby' && data.startAt - serverNow() > 15_000) delay = 2000;
  } catch {
    $('net-error').hidden = false;
    delay = 2000;
  }
  pollTimer = window.setTimeout(() => void poll(), delay);
}

function onState(s: State): void {
  const first = lastState === null;
  lastState = s;
  timing ??= makeTiming(s.charWpm, s.effWpm);
  for (const g of s.groups) slots[g.index] = g;
  if (first) {
    joinedLate = s.phase === 'running';
    lastLevelId = s.level;
    document.body.dataset.mode = s.solo ? 'test' : 'contest';
    chart.setActive(s.chars);
    $<HTMLProgressElement>('progress').max = s.totalMs;
    tickTimer = window.setInterval(tick, 25);
  }
  if (view === 'join' || view === 'lobby') {
    if (s.phase === 'lobby') {
      renderLobby(s);
      if (view !== 'lobby') show('lobby');
    } else if (s.phase === 'running') startRunView();
    else void finish();
  }
}

function renderLobby(s: State): void {
  $('start-clock').textContent = clock(s.startAt);
  $('room-chars').textContent = [...s.chars].join(' ');
  $('room-speed').textContent = `${s.charWpm} / ${s.effWpm} WPM`;
  const people = $('people');
  people.replaceChildren();
  for (const p of s.participants) {
    people.append(el('li', `${p.online ? '' : 'offline'} ${p.you ? 'you' : ''}`.trim(), p.name));
  }
}

function startRunView(): void {
  show('run');
  $('late-note').hidden = !joinedLate;
  const answer = $<HTMLInputElement>('answer');
  answer.value = '';
  answer.focus();
}

/** Audio-clock time at which a given server time occurs. */
const audioTimeAt = (serverMs: number): number => player.now() + (serverMs - serverNow()) / 1000;

function sendAnswer(index: number, text: string): void {
  // Fire and forget; one retry covers a brief network hiccup within the grace period.
  const send = () => call('POST', 'answer', { index, text });
  send().catch(() => window.setTimeout(() => void send().catch(() => undefined), 500));
}

function tick(): void {
  const s = lastState;
  if (!s || !timing) return;
  const elapsed = serverNow() - s.startAt;

  if (view === 'lobby') {
    $('countdown').textContent = formatDuration(-elapsed);
    if (elapsed >= 0) startRunView();
  }

  // Hand upcoming groups to the audio player a few seconds ahead. Each group
  // is anchored to the server clock on its own, so small clock drift between
  // the audio hardware and the system clock cannot accumulate.
  while (scheduled < slots.length && slots[scheduled] && slots[scheduled].startMs - elapsed < 3000) {
    const g = slots[scheduled++];
    if (player.isReady) {
      const tones = buildTimeline([g.text], timing).tones;
      player.schedule(tones, audioTimeAt(s.startAt + g.startMs), prefs.pitch, prefs.volume);
    }
  }

  if (view !== 'run') return;
  const answer = $<HTMLInputElement>('answer');
  $<HTMLProgressElement>('progress').value = Math.max(0, Math.min(s.totalMs, elapsed));
  $('time-left').textContent = formatDuration(s.totalMs - elapsed);

  // Move to the group whose window contains this moment; lock in what was
  // typed for the group that just ended.
  while (slots[current + 1] && elapsed >= slots[current + 1].startMs) {
    if (current >= 0) sendAnswer(current, answer.value);
    answer.value = '';
    current++;
    $('status').textContent = `${t('group', prefs.lang)} ${current + 1} / ${s.groupCount}`;
  }
  if (elapsed >= s.totalMs) {
    if (current >= 0) sendAnswer(current, answer.value);
    void finish();
  }
}

async function finish(): Promise<void> {
  if (view === 'wait' || view === 'result') return;
  window.clearInterval(tickTimer);
  window.clearTimeout(pollTimer);
  show('wait');
  for (;;) {
    try {
      const { status, data } = await call<Result>('GET', 'result');
      $('net-error').hidden = true;
      if (status === 401) return toJoin();
      if (data.ready) {
        if (data.solo && data.pass) {
          prefs.passes[data.level] = data.pass;
          savePrefs();
        }
        lastResult = data;
        renderBoard(data);
        show('result');
        return;
      }
    } catch {
      $('net-error').hidden = false;
    }
    await new Promise((r) => window.setTimeout(r, 700));
  }
}

function renderBoard(r: ReadyResult): void {
  renderResult(r.scores, prefs.lang, r.attemptedFrom);
  $('next-clock').textContent = clock(r.nextStartAt);

  if (r.solo) {
    const verdict = $('test-verdict');
    const values = { a: Math.round(r.accuracy * 100), p: Math.round((r.threshold ?? 0) * 100) };
    verdict.textContent = fill(t(r.passed ? 'testPassed' : 'testFailed', prefs.lang), values);
    verdict.className = `verdict ${r.passed ? 'pass' : 'fail'}`;
    return;
  }
  const board = $('board');
  board.replaceChildren();
  for (const row of r.board) {
    const tr = document.createElement('tr');
    if (row.you) tr.className = 'you';
    tr.append(
      el('td', 'num', String(row.rank)),
      el('td', '', row.name),
      el('td', 'num', `${row.correct} / ${row.total}`),
      el('td', 'num', `${Math.round(row.accuracy * 100)}%`),
    );
    board.append(tr);
  }
}

// ---------- actions

/** We are inside a click here, so the browser allows sound to be switched on. */
async function soundOn(): Promise<void> {
  try { await player.ready(); } catch { /* the lobby shows a button to turn sound on */ }
}

async function enter(token: string): Promise<void> {
  window.clearTimeout(levelsTimer);
  setToken(token);
  await syncClock();
  void poll();
}

async function joinLevel(levelId: string): Promise<void> {
  const name = $<HTMLInputElement>('name').value.trim();
  if (!name) {
    joinError('nameRequired');
    $<HTMLInputElement>('name').focus();
    return;
  }
  joinError(null);
  await soundOn();
  try {
    const { data } = await call<{ token?: string; error?: string }>('POST', 'join', {
      name, level: levelId, pass: passFor(levelId),
    });
    if (!data.token) {
      if (data.error === 'not-qualified') {
        // The stored pass was not accepted (expired, or the server's key changed).
        for (const id of Object.keys(prefs.passes)) {
          if (levelRank(id) >= levelRank(levelId)) delete prefs.passes[id];
        }
        savePrefs();
        if (lastLevels) renderLevels(lastLevels);
        joinError('notQualified');
      } else joinError(data.error === 'room-full' ? 'roomFull' : 'nameRequired');
      return;
    }
    prefs.name = name;
    savePrefs();
    await enter(data.token);
  } catch {
    $('net-error').hidden = false;
  }
}

async function startTest(levelId: string): Promise<void> {
  joinError(null);
  await soundOn();
  try {
    const { data } = await call<{ token?: string }>('POST', 'qualify', { level: levelId });
    if (data.token) await enter(data.token);
  } catch {
    $('net-error').hidden = false;
  }
}

function testTone(): void {
  void player.ready().then(() => {
    updateSoundWarning();
    const s = lastState;
    const tm = s ? makeTiming(s.charWpm, s.effWpm) : makeTiming(20);
    player.schedule(buildTimeline(['VVV'], tm).tones, player.now() + 0.1, prefs.pitch, prefs.volume);
  });
}

for (const id of ['pitch', 'volume'] as const) {
  const input = $<HTMLInputElement>(id);
  const out = $(`${id}-value`);
  const digits = id === 'volume' ? 2 : 0;
  input.value = String(prefs[id]);
  out.textContent = prefs[id].toFixed(digits);
  input.addEventListener('input', () => {
    prefs[id] = Number(input.value);
    out.textContent = prefs[id].toFixed(digits);
    savePrefs();
  });
}
document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => {
  b.addEventListener('click', () => {
    prefs.lang = b.dataset.lang as Lang;
    savePrefs();
    applyLanguage();
  });
});
$('test-tone').addEventListener('click', testTone);
$('enable-sound').addEventListener('click', () => void player.ready().then(updateSoundWarning));
$('next').addEventListener('click', () => {
  const levelId = lastLevelId;
  toJoin();
  void joinLevel(levelId);
});
$('back').addEventListener('click', toJoin);
$('back2').addEventListener('click', toJoin);
$('name').addEventListener('input', () => joinError(null));
$('answer').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.preventDefault();
});

// ---------- start

applyLanguage();
if (getToken()) {
  // Page reloaded mid-session: pick up where we were.
  show('lobby');
  void syncClock().then(poll, () => toJoin());
} else {
  toJoin();
}
