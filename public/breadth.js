import { t, ui } from "./i18n.js";
/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createBreadth({ $, escape, date, options, pageHeading, api, toast, startTask, updateButtons, getState }) {
  let data, token = 0, visibleCount = 24;
  const filters = { domain: 'all', group: 'all', facet: 'auto', count: 5, weakOnly: false, q: '' };
  const facets = { auto: t('综合：用途、选型与边界'), recall: t('识别用途'), apply: t('场景选型'), explain: t('比较与边界') };
  function dispose() { ++token; }
  function selection(pointId) {
    return { category: 'all', language: 'dart', count: pointId ? 3 : filters.count, facet: filters.facet,
      weakOnly: pointId ? false : filters.weakOnly, breadth: { domain: filters.domain, group: filters.group }, ...(pointId ? { pointId } : {}) };
  }
  async function renderHub() {
    const request = ++token;
    $('#page').innerHTML = pageHeading('KNOW THE LANDSCAPE', t('技术广度'), t('测一测：知道哪些方案，能否选对工具，并说明边界。')) + t('<p class="interview-help" role="status">正在读取知识地图…</p>');
    try { data = await api('/api/breadth'); } catch (e) { if (request === token) $('#page').innerHTML = ui`<section class="card flat"><h2>暂时无法读取知识地图</h2><p>${escape(e.message)}</p><button id="breadth-retry" class="button primary">重试</button></section>`; if ($('#breadth-retry')) $('#breadth-retry').onclick = renderHub; return; }
    if (request !== token) return;
    const tested = data.points.filter(p => p.progress.reviewed).length, weak = data.points.filter(p => p.progress.needsWork).length;
    $('#page').innerHTML = pageHeading('KNOW THE LANDSCAPE', t('技术广度'), t('设计模式、工程生态、测试与云基础设施。了解用途，再判断选型。')) + ui`
      <section class="stats-row"><div class="stat-card flat"><span class="stat-label">知识领域</span><div class="stat-value">${data.coverage.length}<small>个</small></div></div><div class="stat-card flat"><span class="stat-label">知识点</span><div class="stat-value">${data.points.length}<small>个</small></div></div><div class="stat-card flat"><span class="stat-label">已有测试依据</span><div class="stat-value">${tested}<small>个知识点</small></div></div><div class="stat-card flat"><span class="stat-label">需要补强</span><div class="stat-value">${weak}<small>个知识点</small></div></div></section>
      <section class="card flat breadth-start"><div class="section-heading"><div><h2>测试一个特定领域</h2><p class="card-subtitle">每题约30–90秒，答完提交后看关键答案、解释和具体缺口。</p></div><a class="button flat" href="#study">每日复习 ↗</a></div>
      <form id="breadth-start" class="generator-form"><div class="training-form-grid"><div class="field"><label for="breadth-domain">技术领域</label><select id="breadth-domain">${options({ all: t('跨领域综合'), ...data.domains }, filters.domain)}</select></div><div class="field"><label for="breadth-group">知识方向</label><select id="breadth-group"></select></div><div class="field"><label for="breadth-facet">测试方式</label><select id="breadth-facet">${options(facets, filters.facet)}</select></div><div class="field"><label for="breadth-count">每组题数</label><select id="breadth-count">${[3,5,8].map(n => ui`<option value="${n}" ${n===filters.count?'selected':''}>${n}题</option>`).join('')}</select></div></div>
      <label class="study-check"><input id="breadth-weak" type="checkbox" ${filters.weakOnly?'checked':''}>只测到期复习的知识点</label><button class="button primary" data-ai>开始技术广度测验 →</button><p class="form-note">题数为上限，一组优先覆盖不同知识点。不会也可以直接说明；不按工具名称数量给分。使用顶部所选模型，结果进入现有复习计划。</p></form></section>
      <section class="breadth-map-section"><div class="section-heading"><h2>我的技术知识地图</h2><span class="section-number">已测 ≠ 全面掌握</span></div><p class="interview-help">只有提交过的维度才有评价。未测领域保留“未测试”，不会推断你的项目经验。</p><div id="breadth-map" class="breadth-map"></div></section>
      <section class="card flat breadth-catalog"><div class="section-heading"><div><h2>选择一个知识点直接测</h2><p class="card-subtitle">例如 Melos、Pigeon、KSP、Terraform、设计模式。一次可测试多个独立维度。</p></div></div><div class="field"><label for="breadth-search">搜索知识点</label><input id="breadth-search" value="${escape(filters.q)}" placeholder="例如：生成工具、测试、Melos、Terraform、Strategy…"></div><p id="breadth-match" class="interview-help"></p><div id="breadth-points" class="breadth-points"></div><button id="breadth-more" class="button flat" hidden>查看更多知识点</button></section>
      <section class="language-history training-history"><div class="section-heading"><h2>技术广度测验记录</h2></div>${(getState().studyBatches??[]).filter(b => b.selection.breadth).slice().reverse().map(b => ui`<a href="#breadth/${b.id}" class="history-item flat"><div><h3 class="history-title">${escape(b.title)}</h3><div class="history-meta">${date(b.createdAt)} · ${b.items.filter(i=>i.feedback).length}/${b.items.length}题已评价</div></div><span>${b.items.every(i=>i.feedback||i.skippedAt)?t('回看'):t('继续')} ↗</span></a>`).join('') || t('<div class="card flat empty-small">完成第一轮后，可以在这里回看回答、关键答案与评价。</div>')}</section>`;
    $('#breadth-start').onsubmit = event => { event.preventDefault(); void startTask('/api/study/batches', selection(), 'study'); };
    $('#breadth-domain').onchange = event => { filters.domain = event.target.value; visibleCount = 24; updateGroups(); renderMap(); renderPoints(); };
    $('#breadth-group').onchange = event => { filters.group = event.target.value; visibleCount = 24; renderPoints(); };
    $('#breadth-facet').onchange = event => { filters.facet = event.target.value; };
    $('#breadth-count').onchange = event => { filters.count = Number(event.target.value); };
    $('#breadth-weak').onchange = event => { filters.weakOnly = event.target.checked; };
    $('#breadth-search').oninput = event => { filters.q = event.target.value; visibleCount = 24; renderPoints(); };
    $('#breadth-more').onclick = () => { visibleCount += 24; renderPoints(); };
    updateGroups(); renderMap(); renderPoints(); updateButtons();
  }
  function updateGroups() {
    const available = new Set(data.points.filter(p => filters.domain === 'all' || p.breadth.domain === filters.domain).map(p => p.breadth.group));
    if (filters.group !== 'all' && !available.has(filters.group)) filters.group = 'all';
    $('#breadth-group').innerHTML = options({ all: t('全部方向'), ...Object.fromEntries(Object.entries(data.groups).filter(([id]) => available.has(id))) }, filters.group);
  }
  function renderMap() {
    $('#breadth-map').innerHTML = data.coverage.map(area => `<button class="breadth-area ${filters.domain===area.id?'pressed':'flat'}" data-breadth-domain="${area.id}" aria-pressed="${filters.domain===area.id}"><strong>${escape(t(area.label))}</strong><span>${area.tested?ui`已测 ${area.tested}/${area.total} 个知识点`:ui`未测试 · ${area.total} 个知识点`}</span><small>${area.needsWork?ui`${area.needsWork} 个需补强`:t('用途 · 选型 · 边界')}${area.due?ui` · ${area.due} 个到期`:''}</small><span class="breadth-meter" aria-hidden="true"><i style="width:${Math.round(area.tested/area.total*100)}%"></i></span></button>`).join('');
    $('#breadth-map').querySelectorAll('[data-breadth-domain]').forEach(button => button.onclick = () => { filters.domain = button.dataset.breadthDomain; $('#breadth-domain').value = filters.domain; visibleCount=24; updateGroups(); renderMap(); renderPoints(); $('#breadth-start').scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}); });
  }
  function renderPoints() {
    const q = filters.q.trim().toLowerCase(), points = data.points.filter(p => (filters.domain==='all'||p.breadth.domain===filters.domain) && (filters.group==='all'||p.breadth.group===filters.group) && (!q || [p.title,p.topic,p.description,data.groups[p.breadth.group]].join(' ').toLowerCase().includes(q)));
    $('#breadth-match').textContent = ui`${points.length} 个匹配知识点`;
    $('#breadth-points').innerHTML = points.slice(0,visibleCount).map(p => ui`<article class="study-point breadth-point"><div><div class="tags"><span class="tag">${escape(t(data.domains[p.breadth.domain]))}</span><span class="tag">${escape(t(data.groups[p.breadth.group]))}</span></div><h3>${escape(t(p.title))}</h3><p>${p.progress.reviewed?ui`已测 ${p.progress.reviewed}/${p.progress.total} 个维度${p.progress.needsWork?t(' · 需要补强'):''}`:t('未测试')}${p.progress.due?t(' · 已到复习时间'):''}</p></div><button class="button flat" data-breadth-point="${p.id}" data-ai>测这个 →</button></article>`).join('') || t('<p class="empty-small">没有匹配知识点，请调整技术领域、方向或搜索词。</p>');
    $('#breadth-more').hidden = points.length <= visibleCount;
    $('#breadth-points').querySelectorAll('[data-breadth-point]').forEach(button => button.onclick = () => void startTask('/api/study/batches', selection(button.dataset.breadthPoint), 'study'));
    updateButtons();
  }
  return { renderHub, dispose };
}
