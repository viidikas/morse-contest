// Light and dark theme. Loaded as a plain (non-module) script in <head> so the
// saved theme is applied before the page is drawn, without a flash of the
// wrong colours. Until the visitor picks one, the system setting is followed.

(() => {
  const KEY = 'morse-theme';
  type Theme = 'light' | 'dark';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const saved = (): Theme | null => {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch {
      return null;
    }
  };
  const current = (): Theme => saved() ?? (media.matches ? 'dark' : 'light');

  const saveTheme = (theme: Theme): void => {
    try { localStorage.setItem(KEY, theme); } catch { /* storage unavailable: lasts for this page only */ }
  };

  const SUN =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>';
  const LABEL = {
    en: { light: 'Switch to light theme', dark: 'Switch to dark theme' },
    et: { light: 'Vaheta heledale teemale', dark: 'Vaheta tumedale teemale' },
  };

  let button: HTMLButtonElement | null = null;

  /** The button shows the theme a click switches to. */
  const render = (): void => {
    const theme = current();
    root.dataset.theme = theme;
    if (!button) return;
    const target: Theme = theme === 'dark' ? 'light' : 'dark';
    const label = (root.lang === 'et' ? LABEL.et : LABEL.en)[target];
    button.innerHTML = target === 'dark' ? MOON : SUN;
    button.setAttribute('aria-label', label);
    button.title = label;
  };

  render();
  media.addEventListener('change', render);

  const wire = (): void => {
    const lang = document.querySelector('header .lang');
    if (!lang) return;
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle';
    button.addEventListener('click', () => {
      saveTheme(current() === 'dark' ? 'light' : 'dark');
      render();
    });
    lang.prepend(button);
    render();
    // The pages switch language by changing <html lang>; keep the label in step.
    new MutationObserver(render).observe(root, { attributes: true, attributeFilter: ['lang'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
