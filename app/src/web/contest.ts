// Contest page: join a room, wait in the lobby, copy the shared feed in sync
// with everyone else, then see the scoreboard.

import { makeTiming, buildTimeline, type Timing } from '../engine/morse.js';
import type { GroupScore } from '../engine/score.js';
import { MorsePlayer } from './player.js';
import { t, type Key, type Lang } from './i18n.js';
import { $, el, formatDuration, renderResult } from './results.js';

// ---------- shapes of the server's answers (see server/room.ts)

interface Slot { index: number; text: string; startMs: number; deadlineMs: number }
interface State {
  now: number;
  phase: 'lobby' | 'running' | 'finished';
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
type Result =
  | { ready: false }
  | { ready: true; scores: GroupScore[]; attemptedFrom: number; board: BoardRow[]; nextStartAt: number };

// ---------- small persistent preferences

interface Prefs { lang: Lang; name: string; pitch: number; volume: number }
const PREFS_KEY = 'morse-contest-prefs';
const TOKEN_KEY = 'morse-contest-token'; // per tab, so two tabs are two participants

function loadPrefs(): Prefs {
  const base: Prefs = {
    lang: navigator.language.toLowerCase().startsWith('et') ? 'et' : 'en',
    name: '', pitch: 600, volume: 0.5,
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
  if (lastState) renderLobby(lastState);
  if (lastResult) renderBoard(lastResult);
}

const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString(prefs.lang === 'et' ? 'et-EE' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

function updateSoundWarning(): void {
  $('sound-off').hidden = player.isReady || view === 'join' || view === 'result' || view === 'wait';
}

// ---------- session state

let lastState: State | null = null;
let lastResult: (Result & { ready: true }) | null = null;
let slots: Slot[] = []; // groups received so far, by index
let scheduled = 0; // number of groups already handed to the audio player
let current = -1; // index of the group now being sent
let timing: Timing | null = null;
let joinedLate = false;
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
  setToken('');
  $<HTMLInputElement>('name').value = prefs.name;
  show('join');
  $<HTMLInputElement>('name').focus();
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

function renderBoard(r: Result & { ready: true }): void {
  renderResult(r.scores, prefs.lang, r.attemptedFrom);
  $('next-clock').textContent = clock(r.nextStartAt);
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

async function join(name: string): Promise<void> {
  const error = $('join-error');
  error.hidden = true;
  try {
    await player.ready(); // we are inside a click, so the browser allows sound
  } catch { /* the lobby shows a button to turn sound on */ }
  try {
    const { data } = await call<{ token?: string; error?: string }>('POST', 'join', { name });
    if (!data.token) {
      error.textContent = t(data.error === 'room-full' ? 'roomFull' : 'nameRequired', prefs.lang);
      error.hidden = false;
      return;
    }
    prefs.name = name;
    savePrefs();
    setToken(data.token);
    await syncClock();
    void poll();
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
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void join($<HTMLInputElement>('name').value);
});
$('test-tone').addEventListener('click', testTone);
$('enable-sound').addEventListener('click', () => void player.ready().then(updateSoundWarning));
$('next').addEventListener('click', () => {
  lastResult = null;
  reset();
  setToken('');
  void join(prefs.name);
});
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
