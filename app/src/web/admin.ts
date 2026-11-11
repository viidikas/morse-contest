// Administration: see all accounts and manage them.

import { LEVELS } from '../engine/levels.js';
import { t, type Lang } from './i18n.js';
import { $, el } from './results.js';
import { applyTexts, fetchMe, fill, json, levelName, loadLang, onLanguageChange, renderLogin, renderUserBar, type Me } from './common.js';
import { formatDate, renderHistory, renderStats, type SavedResult, type Stats } from './history.js';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  level: string | null;
  blocked: boolean;
  createdAt: number;
  lastSeenAt: number;
  stats: Stats;
  you: boolean;
  fixedAdmin: boolean;
}

let lang: Lang = loadLang();
let me: Me | null = null;
let users: AdminUser[] = [];
let shown: { user: AdminUser; results: SavedResult[]; stats: Stats } | null = null;

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, label) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

async function change(user: AdminUser, patch: Record<string, unknown>): Promise<void> {
  await json('POST', `api/admin/users/${encodeURIComponent(user.id)}`, patch);
  await loadUsers();
}

async function showResults(user: AdminUser): Promise<void> {
  const { data } = await json<{ results: SavedResult[]; stats: Stats }>(
    'GET', `api/admin/users/${encodeURIComponent(user.id)}/results`,
  );
  shown = { user, ...data };
  render();
  $('user-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderUsers(): void {
  $('user-count').textContent = fill(t('userCount', lang), { n: users.length });
  const body = $('users');
  body.replaceChildren();
  for (const u of users) {
    const row = document.createElement('tr');
    if (u.blocked) row.className = 'skipped';

    const who = el('td', '', '');
    who.append(el('div', 'strong', u.you ? `${u.name} ${t('youMark', lang)}` : u.name), el('div', 'muted small', u.email));

    // Qualification: chosen directly from a list.
    const levelCell = el('td', '', '');
    const select = document.createElement('select');
    select.setAttribute('aria-label', t('colLevel', lang));
    for (const l of LEVELS) {
      const opt = document.createElement('option');
      opt.value = l.requiresTest ? l.id : '';
      opt.textContent = levelName(l.id, lang);
      opt.selected = (u.level ?? '') === opt.value;
      select.append(opt);
    }
    select.addEventListener('change', () => void change(u, { level: select.value || null }));
    levelCell.append(select);

    const actions = el('td', 'row-actions', '');
    actions.append(
      button(t('actResults', lang), 'secondary small', () => void showResults(u)),
      button(t('actRename', lang), 'secondary small', () => {
        const name = window.prompt(fill(t('promptRename', lang), { name: u.name }), u.name);
        if (name !== null && name.trim()) void change(u, { name });
      }),
    );
    if (!u.you) {
      actions.append(button(t(u.blocked ? 'actUnblock' : 'actBlock', lang), 'secondary small', () => void change(u, { blocked: !u.blocked })));
      if (!u.fixedAdmin) {
        actions.append(button(t(u.role === 'admin' ? 'actRemoveAdmin' : 'actMakeAdmin', lang), 'secondary small',
          () => void change(u, { role: u.role === 'admin' ? 'user' : 'admin' })));
      }
      actions.append(button(t('actDelete', lang), 'danger small', () => {
        if (!window.confirm(fill(t('confirmDelete', lang), { name: u.name }))) return;
        void json('DELETE', `api/admin/users/${encodeURIComponent(u.id)}`).then(() => {
          if (shown?.user.id === u.id) shown = null;
          return loadUsers();
        });
      }));
    }

    row.append(
      who,
      el('td', '', t(u.role === 'admin' ? 'roleAdmin' : 'roleUser', lang)),
      levelCell,
      el('td', 'num', String(u.stats.sessions)),
      el('td', 'num', u.stats.averageAccuracy === null ? '–' : `${Math.round(u.stats.averageAccuracy * 100)}%`),
      el('td', '', formatDate(u.lastSeenAt, lang)),
      el('td', u.blocked ? 'bad' : '', t(u.blocked ? 'statusBlocked' : 'statusActive', lang)),
      actions,
    );
    body.append(row);
  }
}

function render(): void {
  applyTexts(lang, 'adminTitle');
  if (!me) return;
  renderUserBar(me, lang, 'admin');
  const isAdmin = me.user?.role === 'admin';
  $('view-login').hidden = !!me.user;
  $('view-denied').hidden = !me.user || isAdmin;
  $('view-admin').hidden = !isAdmin;
  if (!me.user) return renderLogin(me, lang);
  if (!isAdmin) return;

  renderUsers();
  $('user-results').hidden = !shown;
  if (shown) {
    $('user-results-title').textContent = fill(t('resultsOf', lang), { name: shown.user.name });
    renderStats($('user-stats'), shown.stats, lang);
    renderHistory($('user-history'), shown.results, lang);
  }
}

async function loadUsers(): Promise<void> {
  const { status, data } = await json<{ users?: AdminUser[] }>('GET', 'api/admin/users');
  if (status === 200 && data.users) users = data.users;
  if (shown) shown.user = users.find((u) => u.id === shown!.user.id) ?? shown.user;
  render();
}

async function load(): Promise<void> {
  me = await fetchMe();
  if (me.user?.role === 'admin') await loadUsers();
  else render();
}

onLanguageChange((next) => {
  lang = next;
  render();
});
applyTexts(lang, 'adminTitle');
void load();
