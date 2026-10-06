import { element, elements } from './dom.ts';
import { t } from "./i18n.js";
// A compact trigger and a separately sized list, with native button keyboard support.
export function createModelPicker(onSelect) {
  const trigger = element('#model-select');
  const label = element('#model-name');
  const panel = element('#model-options');
  let models = [], selected = '', search = '', searchTimer;
  function close(restoreFocus = false) {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }
  function position() {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    const upward = below < 220 && above > below;
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
    panel.style.maxHeight = `${Math.max(44, Math.min(420, upward ? above : below))}px`;
    panel.style.top = upward ? 'auto' : `${rect.bottom + 8}px`;
    panel.style.bottom = upward ? `${window.innerHeight - rect.top + 8}px` : 'auto';
  }
  function open(last = false) {
    if ((/** @type {HTMLButtonElement} */ (trigger)).disabled || !models.length) return;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    position();
    panel.scrollTop = 0;
    const options = [...elements('button', panel)];
    (last ? options.at(-1) : options.find(option => (/** @type {HTMLElement} */ (option)).dataset.model === selected) ?? options[0]).focus();
  }
  trigger.addEventListener('click', () => panel.hidden ? open() : close());
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); open(event.key === 'ArrowUp');
    }
  });
  panel.addEventListener('click', event => {
    const option = /** @type {HTMLElement} */ ((/** @type {HTMLElement} */ (event.target)).closest('[data-model]'));
    if (!option || (/** @type {HTMLButtonElement} */ (trigger)).disabled) return;
    close(true);
    if (option.dataset.model !== selected) void onSelect(option.dataset.model);
  });
  panel.addEventListener('keydown', event => {
    const options = [...elements('button', panel)], current = options.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    let next;
    if (event.key === 'ArrowDown') next = (current + 1) % options.length;
    if (event.key === 'ArrowUp') next = (current - 1 + options.length) % options.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') { close(true); return; }
    if (next !== undefined) { event.preventDefault(); (/** @type {HTMLElement} */ (options[next])).focus(); return; }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
      search += event.key.toLowerCase(); clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { search = ''; }, 700);
      const match = options.find(option => option.textContent.toLowerCase().startsWith(search));
      if (match) (/** @type {HTMLElement} */ (match)).focus();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(/** @type {Node} */ (event.target)) && !trigger.contains(/** @type {Node} */ (event.target))) close();
  });
  document.addEventListener('focusin', event => {
    if (!panel.hidden && !panel.contains(/** @type {Node} */ (event.target)) && event.target !== trigger) close();
  });
  window.addEventListener('resize', () => { if (!panel.hidden) position(); });
  window.addEventListener('scroll', event => { if (!panel.hidden && !panel.contains(/** @type {Node} */ (event.target))) close(); }, true);
  return {
    update(values, value) {
      models = values; selected = value;
      label.textContent = models.find(model => model.id === selected)?.name ?? selected;
      trigger.setAttribute('aria-label', `${t("modelPicker.codexModel", { textContent: label.textContent })}`);
      panel.replaceChildren(...models.map(model => {
        const option = document.createElement('button');
        option.type = 'button'; option.tabIndex = -1;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-label', model.name);
        option.setAttribute('aria-selected', String(model.id === selected));
        option.dataset.model = model.id; option.textContent = model.name;
        return option;
      }));
      close();
    },
    setDisabled(value) { (/** @type {HTMLButtonElement} */ (trigger)).disabled = value; if (value) close(); },
  };
}
