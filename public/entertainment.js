import { element, elements } from './dom.ts';
import { t, ui, userLanguage } from "./i18n.js";
import { CARD_CATEGORIES, KNOWLEDGE_CARDS, shuffledCards } from './knowledge-cards.js';
import './entertainment.css';

// Feathered, textured sprites keep the fog local and avoid full-screen blur filters.
function createSmoke(canvas, scene) {
  const context = canvas.getContext('2d');
  if (!context) return { burst() {}, dispose() {} };
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sprites = ['153,172,183', '147,125,165', '117,162,159'].map(color => {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 256;
    const paint = sprite.getContext('2d');
    for (let i = 0; i < 24; i++) {
      const angle = i * 2.39996, distance = 18 + (i % 7) * 7;
      const x = 128 + Math.cos(angle) * distance, y = 128 + Math.sin(angle) * distance * .7;
      const radius = 32 + (i % 5) * 8;
      const gradient = paint.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(${color},.12)`);
      gradient.addColorStop(.45, `rgba(${color},.06)`);
      gradient.addColorStop(1, `rgba(${color},0)`);
      paint.fillStyle = gradient;
      paint.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    return sprite;
  });
  const clouds = Array.from({ length: 32 }, (_, i) => ({
    x: Math.random(), y: .28 + Math.random() * .7, size: .18 + Math.random() * .24,
    phase: Math.random() * Math.PI * 2, speed: .06 + Math.random() * .09, sprite: sprites[i % sprites.length],
  }));
  let width = 1, height = 1, frame = 0, last = 0, time = 0, burstAt = -Infinity, disposed = false;
  function paint() {
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = 'screen';
    const t = time / 1000, burst = Math.max(0, 1 - (time - burstAt) / 1600);
    for (const cloud of clouds) {
      const wave = t * cloud.speed + cloud.phase;
      const size = Math.min(420, Math.max(130, width * cloud.size)) * (1 + burst * .6);
      const x = (cloud.x + Math.sin(wave) * .13) * width;
      const y = (cloud.y + Math.cos(wave * .8) * .12 - burst * .12) * height;
      context.globalAlpha = .18 + Math.sin(wave) * .04 + burst * .48;
      context.save();
      context.translate(x, y);
      context.rotate(Math.sin(wave * .6) * .7);
      context.drawImage(cloud.sprite, -size, -size * .6, size * 2, size * 1.2);
      context.restore();
    }
    context.globalAlpha = 1;
  }
  function fit() {
    width = scene.clientWidth; height = scene.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5, 1440 / Math.max(1, width));
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    paint();
  }
  function loop(now) {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    if (last && now - last < 33) return;
    time += last ? Math.min(now - last, 60) : 33;
    last = now; paint();
  }
  function syncMotion() {
    cancelAnimationFrame(frame); frame = 0; last = 0;
    if (!disposed && !document.hidden && !motion.matches) frame = requestAnimationFrame(loop);
    else if (!disposed) paint();
  }
  const resize = new ResizeObserver(fit);
  resize.observe(scene); fit(); syncMotion();
  document.addEventListener('visibilitychange', syncMotion);
  motion.addEventListener('change', syncMotion);
  return {
    burst() { burstAt = time; if (motion.matches) paint(); },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); resize.disconnect();
      document.removeEventListener('visibilitychange', syncMotion);
      motion.removeEventListener('change', syncMotion);
    },
  };
}

export function createEntertainment({ escape, pageHeading }) {
  let root = null, listeners = null, smoke = null;
  let category = 'all', phase = 'idle', deck = [], index = 0, flipped = false, moving = false;
  let openingTimer, moveTimer, settleTimer, swipeTimer, pointer = null, swiped = false;
  const find = selector => element(selector, root);
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const countFor = id => id === 'all' ? KNOWLEDGE_CARDS.length : KNOWLEDGE_CARDS.filter(card => card.category === id).length;
  const number = value => String(value).padStart(2, '0');

  function cancelMove() {
    clearTimeout(moveTimer); clearTimeout(settleTimer);
    moving = false; pointer = null;
    if (find('#ent-travel')) find('#ent-travel').removeAttribute('data-motion');
    if (find('#ent-previous')) find('#ent-previous').disabled = find('#ent-next').disabled = false;
  }
  // Only this bundled, authored catalog is translated; imported/user cards are never passed here.
  const localizedCard = card => ({
    ...card,
    ...Object.fromEntries(['topic','question','answer','takeaway'].map(field => [field,t(card[field],userLanguage())])),
    ...(card.source ? {source:[t(card.source[0],userLanguage()),card.source[1]]} : {}),
  });
  function announce() {
    const card = localizedCard(deck[index]);
    find('#ent-announcement').textContent = ui`${t(CARD_CATEGORIES[card.category].label)}，第 ${index + 1} 张，共 ${deck.length} 张。${flipped ? t('已显示答案。') : t('当前是问题。')}`;
  }
  function renderCard() {
    const card = localizedCard(deck[index]), meta = CARD_CATEGORIES[card.category], button = find('#ent-card');
    flipped = false;
    root.style.setProperty('--ent-accent', meta.color);
    button.dataset.cardId = card.id; button.dataset.flipped = 'false';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', ui`查看答案：${card.question}`);
    button.innerHTML = ui`<span class="ent-card-flipper">
      <span class="ent-card-face ent-card-front" aria-hidden="false">
        <span class="ent-face-top"><span class="ent-card-category">${escape(t(meta.label))}</span><span class="ent-card-number">${number(index + 1)}</span></span>
        <span class="ent-front-content"><span class="ent-card-symbol" aria-hidden="true">${escape(meta.symbol)}</span><span class="ent-card-eyebrow">${meta.english}</span><span class="ent-card-topic">${escape(card.topic)}</span><span class="ent-card-question">${escape(card.question)}</span></span>
        <span class="ent-face-bottom"><span>先想一想，再看答案</span><span class="ent-flip-mark" aria-hidden="true">↺</span></span>
      </span>
      <span class="ent-card-face ent-card-back" aria-hidden="true">
        <span class="ent-face-top"><span class="ent-card-category">${escape(t(meta.label))} · 答案</span><span class="ent-card-number">${number(index + 1)}</span></span>
        <span class="ent-back-content"><span class="ent-card-eyebrow">THE OTHER SIDE</span><span class="ent-card-topic">${escape(card.topic)}</span><span class="ent-card-answer">${card.answer.split('\n').map(p => `<span>${escape(p)}</span>`).join('')}</span><span class="ent-takeaway"><small>记住这一点</small><span>${escape(card.takeaway)}</span></span></span>
        <span class="ent-face-bottom"><span>再点一次，回到问题</span><span class="ent-flip-mark" aria-hidden="true">↺</span></span>
      </span></span>`;
    find('#ent-counter').textContent = `${number(index + 1)} / ${deck.length}`;
    find('#ent-progress').style.width = `${(index + 1) / deck.length * 100}%`;
    find('#ent-deck-label').textContent = category === 'all' ? t('随机漫游 · 全部领域') : ui`主题漫游 · ${t(CARD_CATEGORIES[category].label)}`;
    const reference = find('#ent-reference');
    reference.hidden = true;
    if (card.source) { reference.textContent = `${card.source[0]} ↗`; reference.href = card.source[1]; }
    else reference.removeAttribute('href');
    announce();
  }
  function flip() {
    if (phase !== 'playing' || moving) return;
    const card = localizedCard(deck[index]), button = find('#ent-card');
    flipped = !flipped;
    button.dataset.flipped = String(flipped);
    button.setAttribute('aria-pressed', String(flipped));
    button.setAttribute('aria-label', flipped ? ui`${card.topic}的答案：${card.answer}。再点一次返回问题。` : ui`查看答案：${card.question}`);
    find('.ent-card-front').setAttribute('aria-hidden', String(flipped));
    find('.ent-card-back').setAttribute('aria-hidden', String(!flipped));
    find('#ent-reference').hidden = !flipped || !card.source;
    announce();
  }
  function changeCard(step) {
    if (phase !== 'playing' || moving || deck.length < 2) return;
    moving = true;
    find('#ent-previous').disabled = find('#ent-next').disabled = true;
    find('#ent-card').focus({ preventScroll: true });
    const travel = find('#ent-travel'), direction = step > 0 ? 'next' : 'previous';
    travel.dataset.motion = `${direction}-out`;
    moveTimer = setTimeout(() => {
      if (!root?.isConnected) return;
      index = (index + step + deck.length) % deck.length;
      renderCard(); travel.dataset.motion = `${direction}-in`;
      settleTimer = setTimeout(cancelMove, reducedMotion() ? 0 : 240);
    }, reducedMotion() ? 0 : 170);
  }
  function shuffle() {
    cancelMove();
    const previous = deck[index]?.id;
    deck = shuffledCards(category);
    if (deck.length > 1 && deck[0].id === previous) deck.push(deck.shift());
    index = 0; renderCard();
  }
  function chooseCategory(id) {
    if (phase === 'opening') return;
    category = id;
    elements('[data-ent-category]', root).forEach(button => button.setAttribute('aria-pressed', String(button.dataset.entCategory === id)));
    find('#ent-start-note').textContent = ui`${countFor(id)} 张知识卡 · 随机出现`;
    if (phase === 'playing') shuffle();
  }
  function start() {
    if (phase !== 'idle') return;
    deck = shuffledCards(category); index = 0;
    phase = 'opening'; root.dataset.phase = phase; root.setAttribute('aria-busy', 'true');
    find('#ent-start').disabled = true;
    find('#ent-opening-status').hidden = false;
    elements('[data-ent-category]', root).forEach(button => { (/** @type {HTMLButtonElement} */ (button)).disabled = true; });
    smoke.burst();
    openingTimer = setTimeout(() => {
      if (!root?.isConnected) return;
      phase = 'playing'; root.dataset.phase = phase; root.removeAttribute('aria-busy');
      find('#ent-intro').hidden = true; find('#ent-playing').hidden = false; find('#ent-stop').hidden = false;
      elements('[data-ent-category]', root).forEach(button => { (/** @type {HTMLButtonElement} */ (button)).disabled = false; });
      renderCard(); find('#ent-card').focus({ preventScroll: true });
    }, reducedMotion() ? 0 : 1150);
  }
  function stop() {
    cancelMove(); clearTimeout(swipeTimer); swiped = false; pointer = null;
    phase = 'idle'; root.dataset.phase = phase;
    find('#ent-playing').hidden = true; find('#ent-stop').hidden = true; find('#ent-intro').hidden = false;
    find('#ent-opening-status').hidden = true; find('#ent-start').disabled = false;
    find('#ent-start').focus({ preventScroll: true });
  }
  function dispose() {
    clearTimeout(openingTimer); clearTimeout(swipeTimer); cancelMove();
    listeners?.abort(); smoke?.dispose();
    root = null; listeners = null; smoke = null; phase = 'idle'; swiped = false;
  }
  function render() {
    // Model updates and completed background jobs can rerender the app. Keep the active card.
    if (root?.isConnected) return;
    dispose();
    element('#page').innerHTML = pageHeading('A LITTLE CURIOSITY, A LITTLE MAGIC', t('娱乐模式'), t('让知识从雾里出现。翻一张，想一想，再看答案。'), ui`<span class="ent-heading-tag">✧ ${KNOWLEDGE_CARDS.length} 张知识卡</span>`) + ui`
      <section id="ent-scene" class="ent-scene" data-phase="idle" aria-label="知识卡片漫游">
        <canvas class="ent-smoke" aria-hidden="true"></canvas><div class="ent-stars" aria-hidden="true"></div><div class="ent-reveal" aria-hidden="true"></div>
        <div class="ent-room-header"><span class="ent-room-title"><span aria-hidden="true">✧</span> THE KNOWLEDGE ROOM</span><button id="ent-stop" class="ent-text-button" type="button" hidden>返回开场 ↗</button><span class="ent-room-note">跟着好奇心，随便逛逛。</span></div>
        <div class="ent-categories" role="group" aria-label="知识领域">
          ${[['all', t('全部'), KNOWLEDGE_CARDS.length], ...Object.entries(CARD_CATEGORIES).map(([id, meta]) => [id, t(meta.label), countFor(id)])].map(([id, label, count]) => `<button type="button" data-ent-category="${id}" aria-pressed="${category === id}">${label}<small>${count}</small></button>`).join('')}
        </div>
        <div id="ent-intro" class="ent-intro">
          <div class="ent-intro-deck" aria-hidden="true"><span class="ent-preview-card ent-preview-left">{ }</span><span class="ent-preview-card ent-preview-right">⌘</span><span class="ent-preview-card ent-preview-main"><small>A LITTLE DISCOVERY</small><span>?</span><i>答案，藏在另一面。</i></span><span class="ent-orbit-star">✧</span></div>
          <span class="ent-intro-eyebrow">TURN CURIOSITY INTO DISCOVERY</span><h2>把知识，翻成一点乐趣。</h2><p>不赶时间。先想一想，<br>再翻开另一面的答案。</p>
          <button id="ent-start" class="ent-start" type="button">开始漫游 <span aria-hidden="true">↗</span></button>
          <small id="ent-start-note">${countFor(category)} 张知识卡 · 随机出现</small><p id="ent-opening-status" class="visually-hidden" role="status" hidden>雾正在散开，知识卡即将出现…</p>
        </div>
        <div id="ent-playing" class="ent-playing" hidden>
          <div class="ent-deck-meta"><span id="ent-deck-label"></span><span id="ent-counter" aria-label="牌组位置"></span></div>
          <div class="ent-table">
            <button id="ent-previous" class="ent-nav ent-nav-previous" type="button" aria-label="上一张知识卡"><span aria-hidden="true">←</span><small>上一张</small></button>
            <div class="ent-card-slot"><div id="ent-travel" class="ent-card-travel"><button id="ent-card" class="ent-card" type="button" aria-pressed="false"></button></div></div>
            <button id="ent-next" class="ent-nav ent-nav-next" type="button" aria-label="下一张知识卡"><span aria-hidden="true">→</span><small>下一张</small></button>
          </div>
          <div class="ent-reference-line"><a id="ent-reference" target="_blank" rel="noopener noreferrer" hidden></a></div>
          <div class="ent-play-controls"><button id="ent-shuffle" class="ent-text-button" type="button"><span aria-hidden="true">⤨</span> 重新洗牌</button><span class="ent-desktop-hint">← → 换卡 · 点击 / 空格翻面</span><span class="ent-mobile-hint">左右滑动换卡 · 点击翻面</span><span class="ent-position-track" aria-hidden="true"><i id="ent-progress"></i></span></div>
        </div>
        <p id="ent-announcement" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"></p>
      </section>`;
    root = element('#ent-scene');
    listeners = new AbortController();
    const on = (element, event, callback) => element.addEventListener(event, callback, { signal: listeners.signal });
    on(find('#ent-start'), 'click', start); on(find('#ent-stop'), 'click', stop);
    on(find('#ent-shuffle'), 'click', shuffle);
    on(find('#ent-previous'), 'click', () => changeCard(-1)); on(find('#ent-next'), 'click', () => changeCard(1));
    elements('[data-ent-category]', root).forEach(button => on(button, 'click', () => chooseCategory(button.dataset.entCategory)));
    const card = find('#ent-card');
    on(card, 'click', event => { if (swiped) { event.preventDefault(); swiped = false; return; } flip(); });
    on(card, 'pointerdown', event => {
      if (phase !== 'playing' || moving || !event.isPrimary || event.button !== 0) return;
      pointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
      if (event.pointerType === 'mouse') card.setPointerCapture(event.pointerId);
    });
    on(card, 'pointercancel', () => { pointer = null; });
    on(card, 'pointerup', event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y; pointer = null;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      swiped = true; clearTimeout(swipeTimer); swipeTimer = setTimeout(() => { swiped = false; }, 350);
      changeCard(dx < 0 ? 1 : -1);
    });
    on(root, 'keydown', event => {
      if (phase !== 'playing' || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('[data-ent-category], a, input, textarea, select, [contenteditable]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); changeCard(event.key === 'ArrowRight' ? 1 : -1); }
    });
    smoke = createSmoke(find('canvas'), root);
  }
  return { render, dispose };
}
