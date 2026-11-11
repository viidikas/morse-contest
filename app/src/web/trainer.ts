// Solo trainer: the same listen-and-type loop a contest session will use,
// run entirely in the browser.

import { KOCH_ORDER, kochChars, makeTiming, buildTimeline, type Timeline } from '../engine/morse.js';
import { makeRng, randomGroups } from '../engine/content.js';
import { scoreGroup, type GroupScore } from '../engine/score.js';
import { MorsePlayer } from './player.js';
import { t, type Key, type Lang } from './i18n.js';
import { $, formatDuration, renderResult } from './results.js';

interface Settings {
  lang: Lang;
  level: number;
  charWpm: number;
  effWpm: number;
  pitch: number;
  volume: number;
  groups: number;
  pauseS: number;
}

const DEFAULTS: Settings = {
  lang: 'en', level: 2, charWpm: 20, effWpm: 8, pitch: 600, volume: 0.5, groups: 20, pauseS: 3,
};
const STORE_KEY = 'morse-trainer-settings';
const LEAD_IN_S = 1.5;

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

const views = { setup: $('view-setup'), run: $('view-run'), result: $('view-result') };
function show(view: keyof typeof views): void {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
}

// ---------- language

function applyLanguage(): void {
  document.documentElement.lang = settings.lang;
  document.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => {
    el.textContent = t(el.dataset.t as Key, settings.lang);
  });
  $<HTMLInputElement>('answer').placeholder = t('typeHere', settings.lang);
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === settings.lang));
  });
  document.title = t('title', settings.lang);
  updateDerived();
  if (lastScores) showResult(lastScores);
}

// ---------- settings form

const fields: { id: string; key: Exclude<keyof Settings, 'lang'>; digits: number }[] = [
  { id: 'level', key: 'level', digits: 0 },
  { id: 'charWpm', key: 'charWpm', digits: 0 },
  { id: 'effWpm', key: 'effWpm', digits: 0 },
  { id: 'pitch', key: 'pitch', digits: 0 },
  { id: 'volume', key: 'volume', digits: 2 },
  { id: 'groups', key: 'groups', digits: 0 },
  { id: 'pauseS', key: 'pauseS', digits: 1 },
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
}

// ---------- running a round

let timer: number | undefined;
let lastScores: GroupScore[] | null = null;

async function testTone(): Promise<void> {
  await player.ready();
  const timeline = buildTimeline(['VVV'], makeTiming(settings.charWpm, settings.effWpm));
  player.stop();
  player.schedule(timeline.tones, player.now() + 0.1, settings.pitch, settings.volume);
}

async function start(): Promise<void> {
  await player.ready();
  const { timeline } = currentTimeline(Date.now());
  const answers: string[] = new Array<string>(timeline.groups.length).fill('');
  const answer = $<HTMLInputElement>('answer');
  const status = $('status');
  const bar = $<HTMLProgressElement>('progress');

  show('run');
  answer.value = '';
  answer.focus();
  bar.max = timeline.totalMs;
  bar.value = 0;
  status.textContent = t('getReady', settings.lang);

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
      finish(timeline, answers);
    }
  };
  timer = window.setInterval(tick, 25);
}

function stopRound(): void {
  window.clearInterval(timer);
  player.stop();
  show('setup');
}

function finish(timeline: Timeline, answers: string[]): void {
  window.clearInterval(timer);
  player.stop();
  lastScores = timeline.groups.map((g, i) => scoreGroup(g.text, answers[i]));
  showResult(lastScores);
  show('result');
  $<HTMLButtonElement>('again').focus();
}

// ---------- result

function showResult(scores: GroupScore[]): void {
  const sum = renderResult(scores, settings.lang);
  $('level-up').hidden = !(sum.accuracy >= 0.9 && settings.level < KOCH_ORDER.length);
}

// ---------- wiring

initForm();
applyLanguage();
show('setup');
$('test-tone').addEventListener('click', () => void testTone());
$('start').addEventListener('click', () => void start());
$('stop').addEventListener('click', stopRound);
$('again').addEventListener('click', () => show('setup'));
$('answer').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.preventDefault();
});
