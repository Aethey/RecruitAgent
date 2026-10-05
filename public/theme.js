// Load before styles and the main bundle so a saved dark theme never flashes light.
const key = 'algo-practice:theme';
const system = window.matchMedia('(prefers-color-scheme: dark)');
const valid = value => ['system', 'light', 'dark'].includes(value);
let preference = 'system';
try { const saved = localStorage.getItem(key); if (valid(saved)) preference = saved; } catch {}
function apply() {
  const theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#202830' : '#e8ebee');
  const toggle = (/** @type {HTMLButtonElement} */ (document.querySelector('#theme-toggle')));
  if (toggle) {
    toggle.setAttribute('aria-checked', String(theme === 'dark'));
    const titles = { zh: ['切换至浅色主题', '切换至深色主题'], en: ['Switch to light theme', 'Switch to dark theme'], ja: ['ライトテーマに切り替え', 'ダークテーマに切り替え'] };
    toggle.title = (titles[document.documentElement.dataset.uiLanguage] ?? titles.zh)[theme === 'dark' ? 0 : 1];
  }
  window.dispatchEvent(new CustomEvent('app-theme-change', { detail: { theme } }));
}
apply();
system.addEventListener('change', () => { if (preference === 'system') apply(); });
window.addEventListener('storage', event => {
  if (event.key === key || event.key === null) { preference = valid(event.newValue) ? event.newValue : 'system'; apply(); }
});
document.addEventListener('DOMContentLoaded', () => {
  const toggle = (/** @type {HTMLButtonElement} */ (document.querySelector('#theme-toggle')));
  apply();
  toggle.addEventListener('click', () => {
    preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(key, preference); } catch {}
    apply();
  });
});
