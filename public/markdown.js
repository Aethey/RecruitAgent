import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function safeMarkdown(value) {
  const html = DOMPurify.sanitize(marked.parse(value, { async: false, gfm: true, breaks: true }), {
    USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'iframe', 'object', 'embed', 'img', 'video', 'audio'],
    FORBID_ATTR: ['style', 'id', 'name'],
  });
  const fragment = document.createElement('div'); fragment.innerHTML = html;
  fragment.querySelectorAll('a').forEach(link => {
    try {
      const url = new URL(link.getAttribute('href'), location.href);
      if (!['https:', 'http:'].includes(url.protocol)) link.removeAttribute('href');
      else { link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    } catch { link.removeAttribute('href'); }
  });
  return fragment.innerHTML;
}
