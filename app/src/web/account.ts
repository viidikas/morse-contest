// "My results": the profile and everything saved for the signed-in account.

import { t, type Lang } from './i18n.js';
import { $ } from './results.js';
import { applyTexts, fetchMe, json, levelName, loadLang, onLanguageChange, renderLogin, renderUserBar, type Me } from './common.js';
import { renderHistory, renderStats, renderWeakChars, type SavedResult, type Stats } from './history.js';

let lang: Lang = loadLang();
let me: Me | null = null;
let data: { results: SavedResult[]; stats: Stats } | null = null;

function render(): void {
  applyTexts(lang, 'accountTitle');
  if (!me) return;
  renderUserBar(me, lang, 'account');
  $('view-login').hidden = !!me.user;
  $('view-account').hidden = !me.user;
  if (!me.user) return renderLogin(me, lang);

  $('email').textContent = me.user.email;
  $('level').textContent = levelName(me.user.level, lang);
  if (data) {
    renderStats($('stats'), data.stats, lang);
    renderHistory($('history'), data.results, lang);
    renderWeakChars($('weak'), data.results, lang);
  }
}

async function load(): Promise<void> {
  me = await fetchMe();
  if (me.user) {
    $<HTMLInputElement>('name').value = me.user.name;
    data = (await json<{ results: SavedResult[]; stats: Stats }>('GET', 'api/my/results')).data;
  }
  render();
}

$('profile-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const note = $('save-note');
  note.hidden = true;
  void json<{ user?: Me['user']; error?: string }>('POST', 'api/me', { name: $<HTMLInputElement>('name').value }).then(
    ({ data: out }) => {
      note.hidden = false;
      note.className = out.user ? 'ok' : 'warn';
      note.textContent = t(out.user ? 'saved' : 'nameRequired', lang);
      if (out.user && me) {
        me.user = out.user;
        render();
      }
    },
  );
});

onLanguageChange((next) => {
  lang = next;
  render();
});
applyTexts(lang, 'accountTitle');
void load();
