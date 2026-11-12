// Solo trainer, run entirely in the browser, in two modes:
// - fixed round: a set number of groups on a fixed rhythm, the same
//   listen-and-type loop a contest session uses, scored at the end;
// - continuous: each group repeats until it has been typed, the answer is
//   shown right away, and the session runs until Stop, which shows an analysis.

import { KOCH_ORDER, kochChars, makeTiming, buildTimeline, type Timeline } from '../engine/morse.js';
import { makeRng, randomGroups, type Rng } from '../engine/content.js';
import { normalize, scoreGroup, type GroupScore } from '../engine/score.js';
import { analyzePractice, type Attempt } from '../engine/practice.js';
import { MorsePlayer } from './player.js';
import { initChart } from './chart.js';
import { t, type Key, type Lang } from './i18n.js';
import { $, el, formatDuration, renderResult, typedCell } from './results.js';

type Mode = 'rounds' | 'continuous';

interface Settings {
  lang: Lang;
  mode: Mode;
  level: number;
  charWpm: number;
  effWpm: number;
  pitch: number;
  volume: number;
  groups: number;
  pauseS: number;
  /** Continuous mode: characters in each group. */
  groupLen: number;
  /** Continuous mode: silence after a group before it is played again. */
  repeatS: number;
}

const DEFAULTS: Settings = {
  lang: 'en', mode: 'rounds', level: 2, charWpm: 20, effWpm: 8, pitch: 600, volume: 0.5, groups: 20, pauseS: 3,
  groupLen: 3, repeatS: 2,
};
const STORE_KEY = 'morse-trainer-settings';
const LEAD_IN_S = 1.5;
/** Continuous mode: pause between a typed group and the next one. */
const NEXT_GROUP_S = 0.7;
/** Continuous mode: rows kept in the live list. */
const LIVE_ROWS = 30;

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* storage unavailable: use defaults */ }
  const browserLang: Lang = navigator.language.toLowerCase().startsWith('et') ? 'et' : 'en';
  return { ...DEFAULTS, lang: browserLang };
}

function saveSettings(s: Settings): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const settings = loadSettings();
const player = new MorsePlayer();
const chart = initChart();
const fill = (key: Key, values: Record<string, string | number>): string =>
  t(key, settings.lang).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

const views = { setup: $('view-setup'), run: $('view-run'), result: $('view-result') };
function show(view: keyof typeof views): void {
  for (const [name, node] of Object.entries(views)) node.hidden = name !== view;
}

// ---------- language and mode

function applyLanguage(): void {
  document.documentElement.lang = settings.lang;
  document.querySelectorAll<HTMLElement>('[data-t]').forEach((node) => {
    node.textContent = t(node.dataset.t as Key, settings.lang);
  });
  $<HTMLInputElement>('answer').placeholder = t('typeHere', settings.lang);
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === settings.lang));
  });
  document.querySelector('.seg')?.setAttribute('aria-label', t('practiceMode', settings.lang));
  document.title = t('title', settings.lang);
  chart.setLabels(t('chartTitle', settings.lang), t('chartShow', settings.lang), t('chartHide', settings.lang));
  updateDerived();
  if (lastScores) showResult();
}

function applyMode(): void {
  document.body.dataset.practice = settings.mode;
  document.querySelectorAll<HTMLButtonElement>('[data-practice]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.practice === settings.mode));
  });
}

// ---------- settings form

const fields: { id: string; key: Exclude<keyof Settings, 'lang' | 'mode'>; digits: number }[] = [
  { id: 'level', key: 'level', digits: 0 },
  { id: 'charWpm', key: 'charWpm', digits: 0 },
  { id: 'effWpm', key: 'effWpm', digits: 0 },
  { id: 'pitch', key: 'pitch', digits: 0 },
  { id: 'volume', key: 'volume', digits: 2 },
  { id: 'groups', key: 'groups', digits: 0 },
  { id: 'pauseS', key: 'pauseS', digits: 1 },
  { id: 'groupLen', key: 'groupLen', digits: 0 },
  { id: 'repeatS', key: 'repeatS', digits: 1 },
];

function currentTimeline(seed: number): { groups: string[]; timeline: Timeline } {
  const chars = kochChars(settings.level);
  const groups = randomGroups(makeRng(seed), chars, { count: settings.groups, newestWeight: 2 });
  const timing = makeTiming(settings.charWpm, settings.effWpm);
  return { groups, timeline: buildTimeline(groups, timing, settings.pauseS * 1000) };
}

function updateDerived(): void {
  for (const f of fields) {
    const out = document.getElementById(`${f.id}-value`);
    if (out) out.textContent = settings[f.key].toFixed(f.digits);
  }
  $('chars').textContent = [...kochChars(settings.level)].join(' ');
  chart.setActive(kochChars(settings.level));
  $('duration').textContent = formatDuration(currentTimeline(1).timeline.totalMs);
}

function initForm(): void {
  $<HTMLInputElement>('level').max = String(KOCH_ORDER.length);
  for (const f of fields) {
    const input = $<HTMLInputElement>(f.id);
    input.value = String(settings[f.key]);
    input.addEventListener('input', () => {
      settings[f.key] = Number(input.value);
      // Overall speed can never exceed character speed.
      if (settings.effWpm > settings.charWpm) {
        settings.effWpm = settings.charWpm;
        $<HTMLInputElement>('effWpm').value = String(settings.effWpm);
      }
      saveSettings(settings);
      updateDerived();
    });
  }
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => {
    b.addEventListener('click', () => {
      settings.lang = b.dataset.lang as Lang;
      saveSettings(settings);
      applyLanguage();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-practice]').forEach((b) => {
    b.addEventListener('click', () => {
      settings.mode = b.dataset.practice as Mode;
      saveSettings(settings);
      applyMode();
    });
  });
}

// ---------- state shared by both modes

let timer: number | undefined;
/** Scores of the last finished session, shown on the result view. */
let lastScores: GroupScore[] | null = null;
/** Fixed round: groups in the round; more than the scores when Stop was pressed. */
let lastTotal = 0;
/** Continuous: the attempts of the last session, for the analysis. Null after a fixed round. */
let lastAttempts: Attempt[] | null = null;
/** Ends the running session; set while one is running. */
let stopHandler: (() => void) | null = null;
/** Continuous: called when the answer field changes or Enter is pressed. */
let answerHandler: ((submit: boolean) => void) | null = null;

async function testTone(): Promise<void> {
  await player.ready();
  const timeline = buildTimeline(['VVV'], makeTiming(settings.charWpm, settings.effWpm));
  player.stop();
  player.schedule(timeline.tones, player.now() + 0.1, settings.pitch, settings.volume);
}

function endSession(): void {
  window.clearInterval(timer);
  player.stop();
  stopHandler = null;
  answerHandler = null;
}

function stopSession(): void {
  if (stopHandler) stopHandler();
  else {
    endSession();
    show('setup');
  }
}

function prepareRun(): HTMLInputElement {
  const answer = $<HTMLInputElement>('answer');
  show('run');
  answer.value = '';
  answer.focus();
  $('status').textContent = t('getReady', settings.lang);
  $('time-left').textContent = '';
  return answer;
}

// ---------- fixed round

async function startRound(): Promise<void> {
  await player.ready();
  const { timeline } = currentTimeline(Date.now());
  const answers: string[] = new Array<string>(timeline.groups.length).fill('');
  const answer = prepareRun();
  const status = $('status');
  const bar = $<HTMLProgressElement>('progress');
  bar.max = timeline.totalMs;
  bar.value = 0;

  player.stop();
  const t0 = player.now() + LEAD_IN_S;
  player.schedule(timeline.tones, t0, settings.pitch, settings.volume);

  let current = -1; // index of the group being sent, -1 before the first
  const tick = (): void => {
    const nowMs = (player.now() - t0) * 1000;
    bar.value = Math.max(0, Math.min(timeline.totalMs, nowMs));
    $('time-left').textContent = formatDuration(Math.max(0, timeline.totalMs - nowMs));

    // Advance to the group whose window contains the current moment, locking
    // in the answer of every group whose deadline has passed.
    while (current < timeline.groups.length - 1 && nowMs >= timeline.groups[current + 1].startMs) {
      if (current >= 0) answers[current] = answer.value;
      answer.value = '';
      current++;
      status.textContent = `${t('group', settings.lang)} ${current + 1} / ${timeline.groups.length}`;
    }
    if (nowMs >= timeline.totalMs) {
      if (current >= 0) answers[current] = answer.value;
      finishRound(timeline, answers, timeline.groups.length);
    }
  };
  stopHandler = (): void => {
    // Score the groups already sent. The one in progress counts only if
    // something was typed for it.
    if (current >= 0) answers[current] = answer.value;
    const done = current < 0 ? 0 : answer.value.trim() ? current + 1 : current;
    if (done === 0) {
      endSession();
      show('setup');
      return;
    }
    finishRound(timeline, answers, done);
  };
  timer = window.setInterval(tick, 25);
}

/** Shows the result for the first `count` groups of the round. */
function finishRound(timeline: Timeline, answers: string[], count: number): void {
  endSession();
  lastTotal = timeline.groups.length;
  lastAttempts = null;
  lastScores = timeline.groups.slice(0, count).map((g, i) => scoreGroup(g.text, answers[i]));
  showResult();
  show('result');
  $<HTMLButtonElement>('again').focus();
}

// ---------- continuous practice

async function startContinuous(): Promise<void> {
  await player.ready();
  const rng: Rng = makeRng(Date.now());
  const chars = kochChars(settings.level);
  const timing = makeTiming(settings.charWpm, settings.effWpm);
  const groupLen = settings.groupLen;
  const repeatS = settings.repeatS;
  const answer = prepareRun();
  const live = $('live');
  live.replaceChildren();
  const attempts: Attempt[] = [];
  const startedAt = player.now();

  let text = '';
  let repeats = 0;
  let firstEndAt = 0; // audio time the first playing of this group ends
  let replayAt = Infinity; // audio time of the next repeat

  /** Plays the current group at audio time `at`; returns when it ends. */
  const play = (at: number): number => {
    const timeline = buildTimeline([text], timing);
    player.schedule(timeline.tones, at, settings.pitch, settings.volume);
    const endAt = at + timeline.groups[0].audioEndMs / 1000;
    replayAt = endAt + repeatS;
    return endAt;
  };
  const nextGroup = (delayS: number): void => {
    let next = text;
    // Avoid the same group twice in a row when there is a choice.
    for (let i = 0; i < 5 && next === text; i++) {
      next = randomGroups(rng, chars, { count: 1, groupLength: groupLen, newestWeight: 2 })[0];
    }
    text = next;
    repeats = 0;
    firstEndAt = play(player.now() + delayS);
  };
  const updateStatus = (): void => {
    const score = attempts.reduce((s, a) => s + a.score.correct, 0);
    const total = attempts.reduce((s, a) => s + a.score.total, 0);
    $('status').textContent = attempts.length
      ? fill('continuousStatus', { n: attempts.length, a: Math.round((score / total) * 100) })
      : t('getReady', settings.lang);
  };

  answerHandler = (submit: boolean): void => {
    const typed = answer.value;
    if (!submit && normalize(typed).length < groupLen) return;
    const score = scoreGroup(text, typed);
    attempts.push({ score, repeats, answerMs: Math.max(0, (player.now() - firstEndAt) * 1000) });
    player.stop();
    answer.value = '';

    const row = document.createElement('tr');
    row.append(el('td', 'mono', score.sent), typedCell('td', score), el('td', 'num', repeats ? `↻ ${repeats}` : ''));
    live.prepend(row);
    while (live.children.length > LIVE_ROWS) live.lastElementChild?.remove();
    updateStatus();
    nextGroup(NEXT_GROUP_S);
  };

  const tick = (): void => {
    const now = player.now();
    $('time-left').textContent = formatDuration((now - startedAt) * 1000);
    // Schedule a repeat slightly ahead so it starts exactly on time.
    if (now >= replayAt - 0.05) {
      repeats++;
      play(replayAt);
    }
  };

  stopHandler = (): void => {
    endSession();
    if (attempts.length === 0) {
      show('setup');
      return;
    }
    lastAttempts = attempts;
    lastScores = attempts.map((a) => a.score);
    lastTotal = lastScores.length;
    showResult();
    show('result');
    $<HTMLButtonElement>('again').focus();
  };

  player.stop();
  nextGroup(LEAD_IN_S);
  timer = window.setInterval(tick, 25);
}

// ---------- result

function showResult(): void {
  if (!lastScores) return;
  const scores = lastScores;
  const sum = renderResult(scores, settings.lang);
  const partial = !lastAttempts && scores.length < lastTotal;
  const note = $('stopped-note');
  note.hidden = !partial;
  note.textContent = partial ? fill('stoppedEarly', { n: scores.length, total: lastTotal }) : '';
  // A level-up is suggested only after a full round or a long enough continuous session.
  const enough = lastAttempts ? scores.length >= 20 : !partial;
  $('level-up').hidden = !(enough && sum.accuracy >= 0.9 && settings.level < KOCH_ORDER.length);
  $('analysis').hidden = !lastAttempts;
  if (lastAttempts) renderAnalysis(lastAttempts);
}

function renderAnalysis(attempts: Attempt[]): void {
  const a = analyzePractice(attempts);
  const stat = (value: string, label: Key): HTMLElement => {
    const box = el('div', 'stat', '');
    box.append(el('div', 'stat-value', value), el('div', 'stat-label', t(label, settings.lang)));
    return box;
  };
  $('analysis-stats').replaceChildren(
    stat(String(a.groups), 'statGroups'),
    stat(a.avgRepeats.toFixed(1), 'statAvgRepeats'),
    stat(`${(a.avgAnswerMs / 1000).toFixed(1)} s`, 'statAvgTime'),
  );

  const weak = $('weak-chars');
  weak.replaceChildren();
  if (a.weak.length === 0) weak.append(el('li', 'muted', t('practiseMoreNone', settings.lang)));
  for (const w of a.weak) {
    const parts = [fill('weakCorrect', { p: Math.round((w.correct / w.sent) * 100), n: w.sent })];
    if (w.mixedWith.length) {
      parts.push(`${t('heardAs', settings.lang)} ${w.mixedWith.slice(0, 3).map((m) => `${m.typed} ×${m.count}`).join(', ')}`);
    }
    if (w.repeated) parts.push(fill('weakRepeated', { r: w.repeated }));
    const li = el('li', '', '');
    li.append(el('span', 'mono', w.char), document.createTextNode(parts.join(' · ')));
    weak.append(li);
  }

  const hardest = $('hardest');
  hardest.replaceChildren();
  if (a.hardest.length === 0) hardest.append(el('li', 'muted', t('noRepeats', settings.lang)));
  for (const h of a.hardest) hardest.append(el('li', '', `${h.score.sent} ↻${h.repeats}`));
}

// ---------- wiring

initForm();
applyMode();
applyLanguage();
show('setup');
$('test-tone').addEventListener('click', () => void testTone());
$('start').addEventListener('click', () => void (settings.mode === 'continuous' ? startContinuous() : startRound()));
$('stop').addEventListener('click', stopSession);
$('again').addEventListener('click', () => show('setup'));
$('answer').addEventListener('input', () => answerHandler?.(false));
$('answer').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    answerHandler?.(true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    stopSession();
  }
});
