// Result display shared by the solo trainer and the contest page. Both pages
// contain the same result markup (see the element ids used below).

import { summarize, type GroupScore, type Summary } from '../engine/score.js';
import { t, type Lang } from './i18n.js';

export const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

export function el(tag: string, cls: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Fills in accuracy, mix-ups, the per-character table and the group list.
 * Groups before `attemptedFrom` (missed by joining late) are shown dimmed and
 * left out of the accuracy figure.
 */
export function renderResult(scores: GroupScore[], lang: Lang, attemptedFrom: number = 0): Summary {
  const sum = summarize(scores.slice(attemptedFrom));
  $('accuracy').textContent = `${Math.round(sum.accuracy * 100)}%`;
  $('accuracy-detail').textContent = `${sum.correct} ${t('correctOf', lang)} ${sum.total}`;

  const groups = $('result-groups');
  groups.replaceChildren();
  scores.forEach((s, i) => {
    const row = document.createElement('tr');
    if (i < attemptedFrom) row.className = 'skipped';
    row.append(el('td', 'num', String(i + 1)), el('td', 'mono', s.sent));
    const typed = el('td', 'mono', '');
    for (const op of s.ops) {
      if (op.type === 'ok') typed.append(el('span', 'ok', op.typed));
      else if (op.type === 'sub') typed.append(el('span', 'bad', op.typed));
      else if (op.type === 'miss') typed.append(el('span', 'bad', '_'));
      else typed.append(el('span', 'extra', op.typed));
    }
    row.append(typed, el('td', 'num', `${s.correct}/${s.total}`));
    groups.append(row);
  });

  const chars = $('result-chars');
  chars.replaceChildren();
  for (const c of sum.chars) {
    const row = document.createElement('tr');
    const share = Math.round((c.correct / c.sent) * 100);
    row.append(
      el('td', 'mono', c.char),
      el('td', 'num', String(c.sent)),
      el('td', 'num', String(c.correct)),
      el('td', share < 90 ? 'num bad' : 'num ok', `${share}%`),
    );
    chars.append(row);
  }

  const conf = $('result-confusions');
  conf.replaceChildren();
  if (sum.confusions.length === 0) conf.append(el('li', '', t('noConfusions', lang)));
  for (const c of sum.confusions.slice(0, 8)) {
    conf.append(el('li', '', `${c.sent} ${t('heardAs', lang)} ${c.typed} × ${c.count}`));
  }
  return sum;
}
