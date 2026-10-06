/** Visit complete authored text/attribute fragments, never substrings of a sentence. */
export function mapSource(source: string, markup: boolean, translate: (text: string) => string): string {
  const text = (value: string, html = false) => {
    const trimmed = value.trim();
    if (!trimmed) return value;
    const translated = translate(trimmed);
    return translated === trimmed ? value : value.replace(trimmed, () => html ? escapeHTML(translated) : translated);
  };
  if (!markup) return text(source);
  return source.split(/(<[^>]*>|<[^>]*$)/g).map(part => part.startsWith('<')
    ? part.replace(/\b(title|aria-label|placeholder)=("[^"]*"|'[^']*')/g, (_, name: string, value: string) => `${name}=${value[0]}${text(value.slice(1, -1), true)}${value[0]}`)
    : part.includes('>') ? part.slice(0, part.indexOf('>') + 1) + text(part.slice(part.indexOf('>') + 1), true) : text(part, true)).join('');
}

const escapeHTML = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const placeholders = (value: string) => [...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1]).sort();

/** Parse the full authored template so attributes split by interpolations remain recognizable. */
export function mapTemplate(parts: readonly string[], values: readonly unknown[], translate: (text: string) => string): string {
  const token = (index: number) => `\uFDD0${index}\uFDD1`;
  const authored = parts.map((part, index) => part + (index < values.length ? token(index) : '')).join('');
  const translated = mapSource(authored, authored.includes('<') || authored.includes('>'), text => text.split(/(\uFDD0\d+\uFDD1)/g).map(part => {
    if (/^\uFDD0\d+\uFDD1$/.test(part)) return part;
    return mapSource(part, false, translate);
  }).join(''));
  return translated.replace(/\uFDD0(\d+)\uFDD1/g, (_, index: string) => String(values[Number(index)]));
}
