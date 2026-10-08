/** Follow new text only while the reader is at the end of this transcript. */
export function createTranscriptScroller({ viewport, text = null, latest }) {
  let following = true, position = 0;
  const atEnd = () => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 32;
  const refresh = () => { latest.hidden = following || viewport.scrollHeight <= viewport.clientHeight; };
  const reveal = () => {
    if (!viewport.clientHeight) return;
    viewport.scrollTop = following ? viewport.scrollHeight : position;
    position = viewport.scrollTop;
    refresh();
  };
  const scroll = () => { if (!viewport.clientHeight) return; position = viewport.scrollTop; following = atEnd(); refresh(); };
  const follow = () => { following = true; reveal(); viewport.focus({ preventScroll: true }); };
  viewport.addEventListener('scroll', scroll, { passive: true });
  latest.addEventListener('click', follow);
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reveal);
  resize?.observe(viewport);
  return {
    update(value) {
      if (typeof value !== 'function' && text.textContent === value) return;
      if (viewport.clientHeight) position = viewport.scrollTop;
      if (typeof value === 'function') { if (value() === false) return; }
      else text.textContent = value;
      reveal();
    },
    reveal,
    reset() { following = true; position = 0; viewport.scrollTop = 0; latest.hidden = true; },
    dispose() { resize?.disconnect(); viewport.removeEventListener('scroll', scroll); latest.removeEventListener('click', follow); },
  };
}
