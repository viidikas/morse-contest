// Start page: sign in for the contest, or practise alone without an account.

import { t, type Lang } from './i18n.js';
import { $ } from './results.js';
import { applyTexts, fetchMe, loadLang, onLanguageChange, renderUserBar, type Me } from './common.js';

let lang: Lang = loadLang();
let me: Me | null = null;

function render(): void {
  applyTexts(lang, 'homeTitle');
  if (!me) return;
  renderUserBar(me, lang, 'home');
  // Already signed in: the first button goes straight to the contest.
  if (me.user) {
    $('login-note').textContent = t('homeContestNote', lang);
    $('login-link').textContent = t('toContest', lang);
  }
}

onLanguageChange((next) => {
  lang = next;
  render();
});
applyTexts(lang, 'homeTitle');
void fetchMe().then((m) => {
  me = m;
  render();
}).catch(() => { /* server unreachable: both buttons still work */ });
