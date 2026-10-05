import { element, elements } from './dom.ts';
import { t, ui } from "./i18n.js";
const modules = ['practice', 'history', 'analysis', 'language', 'interview', 'library', 'training', 'study', 'breadth', 'entertainment', 'voice', 'settings'];
const clip = (value, max) => max <= 24 ? value.slice(0, max) : value.length <= max ? value : value.slice(0, max - 24) + t('\n[内容过长，后续已截取]');

function visibleText(page) {
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT), parts = [];
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!node.textContent.trim() || parent.closest('[aria-hidden="true"], [hidden], .monaco-editor, script, style') || !parent.getClientRects().length || getComputedStyle(parent).visibility !== 'visible') continue;
    const closed = parent.closest('details:not([open])');
    if (closed && !closed.querySelector('summary')?.contains(node)) continue;
    parts.push(node.textContent.trim());
  }
  const cardQuestion = element('.ent-card-question', page)?.textContent;
  if (cardQuestion) parts.unshift(ui`当前知识卡的问题：${cardQuestion}`);
  return parts.join('\n');
}

export function createPageContext({ hasEditor, editorValue, editorSelection }) {
  let selectedText = '', selectedRoute = '';
  function metadata() {
    const parts = location.hash.slice(1).split('/');
    const route = modules.includes(parts[0]) ? location.hash : '#practice';
    const module = element('#breadcrumb-current')?.textContent ?? t('当前页面');
    const title = element('#page .problem-panel h2')?.textContent ?? element('#page h1')?.textContent ?? module;
    return { route, title: clip(`${module} · ${title}`, 250) };
  }
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (selection?.toString().trim() && element('#page')?.contains(selection.anchorNode)) {
      selectedText = clip(selection.toString(), 6000); selectedRoute = metadata().route;
    }
  });
  function capture() {
    const page = element('#page'), meta = metadata();
    let budget = 39000;
    const fields = [...elements('input, textarea, select', page)].filter(input =>
      !['password', 'file', 'hidden'].includes((/** @type {HTMLInputElement} */ (input)).type) && !input.closest('.monaco-editor') && input.getClientRects().length,
    ).slice(0, 50).map(input => {
      const label = [...elements('label', page)].find(label => label.htmlFor === input.id)?.textContent
        ?? input.closest('label')?.textContent ?? input.getAttribute('aria-label') ?? input.id ?? (/** @type {HTMLInputElement} */ (input)).name;
      let value = (/** @type {HTMLInputElement} */ (input)).type === 'checkbox' || (/** @type {HTMLInputElement} */ (input)).type === 'radio' ? `${(/** @type {HTMLInputElement} */ (input)).checked ? t('已选') : t('未选')}：${(/** @type {HTMLInputElement} */ (input)).value}`
        : input.tagName === 'SELECT' ? `${(/** @type {HTMLSelectElement} */ (input)).selectedOptions[0]?.textContent ?? ''} (${(/** @type {HTMLInputElement} */ (input)).value})` : (/** @type {HTMLInputElement} */ (input)).value;
      value = clip(String(value), Math.min(19900, Math.max(0, budget))); budget -= value.length;
      return { label: clip(label.trim() || t('页面输入'), 160), value };
    });
    /** @type {Omit<import('../src/chat.ts').PageContext, 'capturedAt' | 'record'>} */
    const context = { ...meta, visibleText: clip(visibleText(page), 29000),
      selectedText: clip(editorSelection() || (selectedRoute === meta.route ? selectedText : ''), 6000), fields,
      ...(hasEditor() ? { editor: clip(editorValue(), 99000) } : {}),
    };
    const pdfPage = element('#pdf-page', page);
    if (pdfPage) context.pdfPage = Number((/** @type {HTMLInputElement} */ (pdfPage)).value);
    return context;
  }
  return { metadata, capture };
}
