// Display of saved results: used on "My results" and on the admin page.

import { t, type Lang } from './i18n.js';
import { el } from './results.js';
import { levelName } from './common.js';

export interface SavedResult {
  id: string;
  kind: 'contest' | 'test';
  level: string;
  startAt: number;
  correct: number;
  total: number;
  accuracy: number;
  rank: number | null;
  people: number;
  passed: boolean | null;
  chars: Record<string, [number, number]>;
}

export interface Stats {
  sessions: number;
  tests: number;
  averageAccuracy: number | null;
  bestAccuracy: number | null;
  wins: number;
}

const pct = (v: number | null): string => (v === null ? '–' : `${Math.round(v * 100)}%`);

export function formatDate(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleString(lang === 'et' ? 'et-EE' : 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function renderStats(box: HTMLElement, s: Stats, lang: Lang): void {
  box.replaceChildren();
  const add = (label: string, value: string): void => {
    const item = el('div', 'stat', '');
    item.append(el('div', 'stat-value', value), el('div', 'stat-label', label));
    box.append(item);
  };
  add(t('statSessions', lang), String(s.sessions));
  add(t('statAverage', lang), pct(s.averageAccuracy));
  add(t('statBest', lang), pct(s.bestAccuracy));
  add(t('statWins', lang), String(s.wins));
  add(t('statTests', lang), String(s.tests));
}

export function renderHistory(body: HTMLElement, results: SavedResult[], lang: Lang): void {
  body.replaceChildren();
  if (results.length === 0) {
    const row = document.createElement('tr');
    const cell = el('td', 'muted', t('noResults', lang)) as HTMLTableCellElement;
    cell.colSpan = 6;
    row.append(cell);
    body.append(row);
    return;
  }
  for (const r of results) {
    const row = document.createElement('tr');
    let kind = t('kindContest', lang);
    if (r.kind === 'test') kind = t(r.passed ? 'kindTestPassed' : 'kindTestFailed', lang);
    row.append(
      el('td', '', formatDate(r.startAt, lang)),
      el('td', '', levelName(r.level, lang)),
      el('td', r.kind === 'test' ? (r.passed ? 'ok' : 'bad') : '', kind),
      el('td', 'num', `${r.correct} / ${r.total}`),
      el('td', 'num', pct(r.accuracy)),
      el('td', 'num', r.rank === null ? '–' : `${r.rank} / ${r.people}`),
    );
    body.append(row);
  }
}

/** Characters with the lowest accuracy over all results, sent at least `minSent` times. */
export function renderWeakChars(list: HTMLElement, results: SavedResult[], lang: Lang, minSent: number = 5): void {
  const totals = new Map<string, [number, number]>();
  for (const r of results) {
    for (const [ch, [sent, correct]] of Object.entries(r.chars ?? {})) {
      const sum = totals.get(ch) ?? [0, 0];
      sum[0] += sent;
      sum[1] += correct;
      totals.set(ch, sum);
    }
  }
  const worst = [...totals.entries()]
    .filter(([, [sent]]) => sent >= minSent)
    .map(([ch, [sent, correct]]) => ({ ch, sent, share: correct / sent }))
    .filter((x) => x.share < 0.9)
    .sort((a, b) => a.share - b.share)
    .slice(0, 8);
  list.replaceChildren();
  if (worst.length === 0) list.append(el('li', 'muted', t('noConfusions', lang)));
  for (const w of worst) {
    const item = el('li', '', '');
    item.append(el('span', 'mono', w.ch), el('span', '', ` ${pct(w.share)} (${w.sent})`));
    list.append(item);
  }
}
