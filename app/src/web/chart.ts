// The Morse table shown beside the page. It can be hidden so it does not
// distract; the choice is remembered in this browser.

import { MORSE } from '../engine/morse.js';

const STORE_KEY = 'morse-chart-open';
const ORDER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?/=';

export interface Chart {
  /** Characters in use right now are shown at full strength, the rest dimmed. Null = all. */
  setActive(chars: string | null): void;
  /** Texts in the current language. */
  setLabels(title: string, show: string, hide: string): void;
}

/**
 * Builds the table and wires the toggle button. Expects a button with id
 * "chart-toggle" in the page.
 */
export function initChart(): Chart {
  const toggle = document.getElementById('chart-toggle') as HTMLButtonElement;
  const aside = document.createElement('aside');
  aside.id = 'chart';
  const heading = document.createElement('h2');
  const grid = document.createElement('div');
  grid.className = 'chart-grid';
  const cells = new Map<string, HTMLElement>();

  for (const ch of ORDER) {
    const cell = document.createElement('div');
    cell.className = 'chart-cell';
    const letter = document.createElement('span');
    letter.className = 'chart-char mono';
    letter.textContent = ch;
    const code = document.createElement('span');
    code.className = 'chart-code';
    code.setAttribute('aria-label', MORSE[ch].replace(/\./g, 'dit ').replace(/-/g, 'dah ').trim());
    for (const element of MORSE[ch]) {
      const mark = document.createElement('i');
      mark.className = element === '.' ? 'dit' : 'dah';
      code.append(mark);
    }
    cell.append(letter, code);
    grid.append(cell);
    cells.set(ch, cell);
  }
  aside.append(heading, grid);
  document.body.prepend(aside);

  let labels = { title: 'Morse table', show: 'Show Morse table', hide: 'Hide Morse table' };
  let open = window.matchMedia('(min-width: 1040px)').matches; // default: open where there is room
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved !== null) open = saved === '1';
  } catch { /* storage unavailable: use the default */ }

  const apply = (): void => {
    document.body.classList.toggle('chart-open', open);
    aside.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? labels.hide : labels.show;
    heading.textContent = labels.title;
  };
  toggle.addEventListener('click', () => {
    open = !open;
    try { localStorage.setItem(STORE_KEY, open ? '1' : '0'); } catch { /* ignore */ }
    apply();
  });
  apply();
  // Animate only later changes, not the state the page opens with.
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('chart-anim')));

  return {
    setActive(chars) {
      for (const [ch, cell] of cells) cell.classList.toggle('inactive', chars !== null && !chars.includes(ch));
    },
    setLabels(title, show, hide) {
      labels = { title, show, hide };
      apply();
    },
  };
}
