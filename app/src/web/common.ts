// Things every signed-in page needs: who is logged in, the bar with the
// account links, the sign-in box, and the language choice.

import { t, type Key, type Lang } from './i18n.js';
import { el } from './results.js';

export interface Account {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  level: string | null;
}

export interface Me {
  user: Account | null;
  /** Whether Google sign-in is set up on the server. */
  google: boolean;
  /** Whether the name-only development login is available (local use only). */
  devLogin: boolean;
}

const PREFS_KEY = 'morse-contest-prefs';

export function loadLang(): Lang {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const lang = raw ? (JSON.parse(raw) as { lang?: Lang }).lang : undefined;
    if (lang === 'en' || lang === 'et') return lang;
  } catch { /* storage unavailable */ }
  return navigator.language.toLowerCase().startsWith('et') ? 'et' : 'en';
}

export function saveLang(lang: Lang): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const prefs = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, lang }));
  } catch { /* ignore */ }
}

/** Fills every element marked data-t with its text and marks the active language button. */
export function applyTexts(lang: Lang, titleKey: Key): void {
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>('[data-t]').forEach((node) => {
    node.textContent = t(node.dataset.t as Key, lang);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  });
  document.title = t(titleKey, lang);
}

export function onLanguageChange(handler: (lang: Lang) => void): void {
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => {
    b.addEventListener('click', () => {
      const lang = b.dataset.lang as Lang;
      saveLang(lang);
      handler(lang);
    });
  });
}

export async function json<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`../${path}`, {
    method,
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as T };
}

export async function fetchMe(): Promise<Me> {
  return (await json<Me>('GET', 'api/me')).data;
}

const LEVEL_NAME: Record<string, Key> = {
  beginner: 'levelBeginner', mid: 'levelMid', advanced: 'levelAdvanced',
};
export const levelName = (id: string | null, lang: Lang): string =>
  id && LEVEL_NAME[id] ? t(LEVEL_NAME[id], lang) : t('levelBeginner', lang);

export const fill = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

/** The line at the top: who is signed in, and links to the other pages. */
export function renderUserBar(me: Me, lang: Lang, current: 'home' | 'contest' | 'account' | 'admin'): void {
  const bar = document.getElementById('userbar');
  if (!bar) return;
  bar.replaceChildren();
  if (!me.user) return;
  const link = (href: string, key: Key, page: string): HTMLElement => {
    const a = el('a', page === current ? 'current' : '', t(key, lang)) as HTMLAnchorElement;
    a.href = href;
    return a;
  };
  bar.append(el('span', 'who', me.user.name), link('contest.html', 'navContest', 'contest'), link('account.html', 'navAccount', 'account'));
  if (me.user.role === 'admin') bar.append(link('admin.html', 'navAdmin', 'admin'));
  const out = el('button', 'link', t('signOut', lang)) as HTMLButtonElement;
  out.type = 'button';
  out.addEventListener('click', () => {
    void json('POST', 'auth/logout').then(() => location.assign('home.html'));
  });
  bar.append(out);
}

/** The sign-in box shown to visitors who are not logged in. */
export function renderLogin(me: Me, lang: Lang): void {
  const box = document.getElementById('login-box');
  if (!box) return;
  box.replaceChildren();
  const failed = new URLSearchParams(location.search).get('login');
  if (failed) box.append(el('p', 'warn', t(failed === 'unavailable' ? 'loginUnavailable' : 'loginFailed', lang)));

  if (me.google) {
    const a = el('a', 'button primary', t('signInGoogle', lang)) as HTMLAnchorElement;
    a.href = '../auth/google';
    box.append(el('p', '', t('loginIntro', lang)), a);
  } else if (me.devLogin) {
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 20;
    input.required = true;
    input.placeholder = t('yourName', lang);
    const go = el('button', 'primary', t('devSignIn', lang)) as HTMLButtonElement;
    go.type = 'submit';
    const field = el('div', 'field-text', '');
    field.append(input);
    const actions = el('div', 'actions', '');
    actions.append(go);
    form.append(el('p', 'muted', t('devLoginNote', lang)), field, actions);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void json('POST', 'auth/dev', { name: input.value }).then(() => location.assign('contest.html'));
    });
    box.append(form);
  } else {
    box.append(el('p', 'warn', t('loginUnavailable', lang)));
  }
}
