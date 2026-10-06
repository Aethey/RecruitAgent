import { studyTitle } from './study-title.js';
import { t, catalogText } from "./i18n.js";
/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createBreadth({ $, escape, date, options, pageHeading, api, toast, startTask, updateButtons, getState }) {
  let data, token = 0, visibleCount = 24;
  const filters = { domain: 'all', group: 'all', facet: 'auto', count: 5, weakOnly: false, q: '' };
  const facets = { auto: t("ui.mixedPurposeSelectionAndBoundaries"), recall: t("ui.identifyPurpose"), apply: t("ui.chooseForAScenario"), explain: t("ui.compareTradeOffs") };
  function dispose() { ++token; }
  function selection(pointId) {
    return { category: 'all', language: 'dart', count: pointId ? 3 : filters.count, facet: filters.facet,
      weakOnly: pointId ? false : filters.weakOnly, breadth: { domain: filters.domain, group: filters.group }, ...(pointId ? { pointId } : {}) };
  }
  async function renderHub() {
    const request = ++token;
    $('#page').innerHTML = pageHeading(t("chrome.knowTheLandscape"), t("ui.technicalBreadth"), t("ui.testYourKnowledgeOfOptionsToolSelectionAnd")) + `<p class="interview-help" role="status">${t("ui.loadingKnowledgeMap")}</p>`;
    try { data = await api('/api/breadth'); } catch (e) { if (request === token) $('#page').innerHTML = `<section class="card flat"><h2>${t("ui.cannotLoadTheKnowledgeMap")}</h2><p>${escape(e.message)}</p><button id="breadth-retry" class="button primary">${t("ui.retry")}</button></section>`; if ($('#breadth-retry')) $('#breadth-retry').onclick = renderHub; return; }
    if (request !== token) return;
    const tested = data.points.filter(p => p.progress.reviewed).length, weak = data.points.filter(p => p.progress.needsWork).length;
    $('#page').innerHTML = pageHeading(t("chrome.knowTheLandscape"), t("ui.technicalBreadth"), t("ui.designPatternsEngineeringEcosystemsTestingAndCloudInfrastructure")) + `
      <section class="stats-row"><div class="stat-card flat"><span class="stat-label">${t("ui.domains")}</span><div class="stat-value">${data.coverage.length}<small>${t("ui.items")}</small></div></div><div class="stat-card flat"><span class="stat-label">${t("ui.knowledgePoints2")}</span><div class="stat-value">${data.points.length}<small>${t("ui.items")}</small></div></div><div class="stat-card flat"><span class="stat-label">${t("ui.testEvidenceAvailable")}</span><div class="stat-value">${tested}<small>${t("ui.knowledgePoints")}</small></div></div><div class="stat-card flat"><span class="stat-label">${t("ui.needsReinforcement2")}</span><div class="stat-value">${weak}<small>${t("ui.knowledgePoints")}</small></div></div></section>
      <section class="card flat breadth-start"><div class="section-heading"><div><h2>${t("ui.testASpecificDomain")}</h2><p class="card-subtitle">${t("ui.eachQuestionTakesAboutSecondsSubmitYourAnswers")}</p></div><a class="button flat" href="#study">${t("ui.dailyReview2")}</a></div>
      <form id="breadth-start" class="generator-form"><div class="training-form-grid"><div class="field"><label for="breadth-domain">${t("ui.technicalDomain")}</label><select id="breadth-domain">${options({ all: t("ui.acrossDomains"), ...data.domains }, filters.domain)}</select></div><div class="field"><label for="breadth-group">${t("ui.knowledgeArea")}</label><select id="breadth-group"></select></div><div class="field"><label for="breadth-facet">${t("ui.testMode")}</label><select id="breadth-facet">${options(facets, filters.facet)}</select></div><div class="field"><label for="breadth-count">${t("ui.questionsPerSet")}</label><select id="breadth-count">${[3,5,8].map(n => `<option value="${n}" ${n===filters.count?'selected':''}>${t("breadth.questions", { n: n })}</option>`).join('')}</select></div></div>
      <label class="study-check"><input id="breadth-weak" type="checkbox" ${filters.weakOnly?'checked':''}>${t("ui.onlyPointsDueForReview")}</label><button class="button primary" data-ai>${t("ui.startBreadthQuiz")}</button><p class="form-note">${t("ui.theQuestionCountIsAMaximumEachSet")}</p></form></section>
      <section class="breadth-map-section"><div class="section-heading"><h2>${t("ui.myTechnicalKnowledgeMap")}</h2><span class="section-number">${t("ui.testedFullyMastered")}</span></div><p class="interview-help">${t("ui.onlySubmittedDimensionsAreEvaluatedUntestedAreasStay")}</p><div id="breadth-map" class="breadth-map"></div></section>
      <section class="card flat breadth-catalog"><div class="section-heading"><div><h2>${t("ui.testOneKnowledgePoint")}</h2><p class="card-subtitle">${t("ui.forExampleMelosPigeonKSPTerraformOrDesign")}</p></div></div><div class="field"><label for="breadth-search">${t("ui.searchKnowledgePoints")}</label><input id="breadth-search" value="${escape(filters.q)}" placeholder="${t("ui.forExampleCodeGenerationTestingMelosTerraformStrategy")}"></div><p id="breadth-match" class="interview-help"></p><div id="breadth-points" class="breadth-points"></div><button id="breadth-more" class="button flat" hidden>${t("ui.showMorePoints")}</button></section>
      <section class="language-history training-history"><div class="section-heading"><h2>${t("ui.breadthQuizHistory")}</h2></div>${(getState().studyBatches??[]).filter(b => b.selection.breadth).slice().reverse().map(b => `<a href="#breadth/${b.id}" class="history-item flat"><div><h3 class="history-title">${escape(studyTitle(b))}</h3><div class="history-meta">${t("breadth.questionsReviewed", { value3: date(b.createdAt), length: b.items.filter(i=>i.feedback).length, length5: b.items.length })}</div></div><span>${b.items.every(i=>i.feedback||i.skippedAt)?t("ui.review"):t("ui.continue")} ↗</span></a>`).join('') || `<div class="card flat empty-small">${t("ui.completeAFirstRoundToReviewYourAnswers")}</div>`}</section>`;
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
    $('#breadth-group').innerHTML = options({ all: t("ui.allAreas"), ...Object.fromEntries(Object.entries(data.groups).filter(([id]) => available.has(id))) }, filters.group);
  }
  function renderMap() {
    $('#breadth-map').innerHTML = data.coverage.map(area => `<button class="breadth-area ${filters.domain===area.id?'pressed':'flat'}" data-breadth-domain="${area.id}" aria-pressed="${filters.domain===area.id}"><strong>${escape(catalogText(area.label))}</strong><span>${area.tested?`${t("breadth.testedKnowledgePoints", { tested: area.tested, total: area.total })}`:`${t("breadth.untestedKnowledgePoints", { total: area.total })}`}</span><small>${area.needsWork?`${t("breadth.needReinforcement", { needsWork: area.needsWork })}`:t("ui.purposeSelectionBoundaries")}${area.due?` ${t("breadth.due", { due: area.due })}`:''}</small><span class="breadth-meter" aria-hidden="true"><i style="width:${Math.round(area.tested/area.total*100)}%"></i></span></button>`).join('');
    $('#breadth-map').querySelectorAll('[data-breadth-domain]').forEach(button => button.onclick = () => { filters.domain = button.dataset.breadthDomain; $('#breadth-domain').value = filters.domain; visibleCount=24; updateGroups(); renderMap(); renderPoints(); $('#breadth-start').scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}); });
  }
  function renderPoints() {
    const q = filters.q.trim().toLowerCase(), points = data.points.filter(p => (filters.domain==='all'||p.breadth.domain===filters.domain) && (filters.group==='all'||p.breadth.group===filters.group) && (!q || [p.title,p.topic,p.description,data.groups[p.breadth.group]].join(' ').toLowerCase().includes(q)));
    $('#breadth-match').textContent = `${t("breadth.matchingPoints", { length: points.length })}`;
    $('#breadth-points').innerHTML = points.slice(0,visibleCount).map(p => `<article class="study-point breadth-point"><div><div class="tags"><span class="tag">${escape(catalogText(data.domains[p.breadth.domain]))}</span><span class="tag">${escape(catalogText(data.groups[p.breadth.group]))}</span></div><h3>${escape(catalogText(p.title))}</h3><p>${p.progress.reviewed?`${t("breadth.testedDimensions", { reviewed: p.progress.reviewed, total: p.progress.total, value3: p.progress.needsWork?t("breadth.message"):'' })}`:t("ui.untested")}${p.progress.due?t("breadth.message2"):''}</p></div><button class="button flat" data-breadth-point="${p.id}" data-ai>${t("ui.testThis")}</button></article>`).join('') || `<p class="empty-small">${t("ui.noMatchingPointsAdjustDomainAreaOrSearch")}</p>`;
    $('#breadth-more').hidden = points.length <= visibleCount;
    $('#breadth-points').querySelectorAll('[data-breadth-point]').forEach(button => button.onclick = () => void startTask('/api/study/batches', selection(button.dataset.breadthPoint), 'study'));
    updateButtons();
  }
  return { renderHub, dispose };
}
