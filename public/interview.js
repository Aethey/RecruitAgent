import { element, elements } from './dom.ts';
import { t, ui } from "./i18n.js";
import { createVoiceInterview } from "./interview-voice.js";
/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createInterviewPractice({ $, escape, date, options, pageHeading, list, api, toast, startTask, updateButtons, getConfig, getState, beginTraining }) {
  const choice = { type: "common", topic: "all", count: 5, jobId: "" };
  const voicePractice = createVoiceInterview({ api, escape, pageHeading, date, getState, toast, beginTraining });
  const sets = () => getState().interviews ?? [];
  const jobs = () => getState().interviewJobs ?? [];
  function dispose() { voicePractice.dispose(); }
  async function flush() { /* Voice transcripts are saved by the backend as each turn completes. */ }
  function remember() { /* No text draft is held by the voice workspace. */ }
  function renderGenerator() {
    void refreshSources();
    const config = getConfig();
    if (!jobs().some(j => j.id === choice.jobId)) choice.jobId = jobs().at(-1)?.id ?? "";
    $("#page").innerHTML = pageHeading("MAKE YOUR POINT", t("把经历，讲到重点。"), t("共通问题、技术追问、职位定制。Codex 语音提问，你用自己的话回答。")) + ui`
      <div class="interview-modes" role="group" aria-label="面试练习类型">${Object.entries(config.interviewTypes).map(([id, label]) => `<button type="button" class="button ${choice.type === id ? "pressed selected" : "flat"}" data-interview-type="${id}" aria-pressed="${choice.type === id}">${escape(t(label))}</button>`).join("")}</div>
      <section class="language-generator interview-generator"><div class="card flat"><div class="section-heading"><div><h2>准备一组面试问题</h2><p class="card-subtitle">准备题目后，进入逐题语音面试。</p></div></div><form id="interview-form" class="generator-form">
        <div class="field"><label for="interview-topic">练习方向</label><select id="interview-topic">${options(config.interviewTopics[choice.type], choice.topic)}</select></div>
        <div class="field"><label for="interview-count">每组题数</label><select id="interview-count">${options({ 3: t("3 道 · 聚焦练习"), 5: t("5 道 · 标准练习"), 8: t("8 道 · 综合练习") }, String(choice.count))}</select></div>
        ${choice.type === "position" ? ui`<div class="field"><label for="interview-job">公司 / 职位资料</label><select id="interview-job">${options(Object.fromEntries(jobs().map(j => [j.id, j.title])), choice.jobId, t("请选择已保存的职位"))}</select></div>` : ""}
        <button class="button primary" type="submit" data-ai>✧ 生成面试问题 →</button><p class="form-note">顶部模型用于准备题目；进入面试后可选择语音模型、音色和语气。</p></form></div>
      <div class="card flat language-intro"><span class="eyebrow">CONCLUSION FIRST</span><h2>先说结论，再说关键行动。</h2><ol><li>听 Codex 提问，可选择显示回答重点 tips。</li><li>用语音回答，先说结论，再说明自己的行动。</li><li>听具体点评：哪些背景可以删、哪些事实需要补；可以重答。</li></ol><p>${escape(config.interviewSources.available ? t("已接入你的简历与所选资料；学习材料与真实经历分别标注。") : t("请先上传自己的简历，并在下方选择出题资料。"))}</p><details class="interview-source-list"><summary>查看出题资料</summary>${list(config.interviewSources.files)}</details></div></section>
      ${materialsForm()}
      ${choice.type === "position" ? jobForm() : ""}
      <section class="language-history"><div class="section-heading"><div><h2>面试练习记录</h2><p class="card-subtitle">保存题目、语音回答转写与点评，保留此前文字练习记录。</p></div></div>${sets().filter(s => s.type === choice.type).reverse().map(s => ui`<a class="history-item flat" href="#interview/${s.id}"><div><h3 class="history-title">${escape(s.title)}</h3><div class="tags"><span class="tag">${s.questions.length} 道问题</span>${s.jobTitle ? `<span class="tag">${escape(s.jobTitle)}</span>` : ""}</div><div class="history-meta">${date(s.updatedAt)} · ${(s.voiceAttempts ?? []).length} 次语音 · ${s.reviews.length} 次文字评价</div></div><span class="history-arrow">↗</span></a>`).join("") || t('<div class="card flat empty-small">还没有这一类的练习，先生成一组问题。</div>')}</section>`;
    elements("[data-interview-type]").forEach(button => button.onclick = () => { choice.type = button.dataset.interviewType; choice.topic = "all"; renderGenerator(); });
    $("#interview-topic").onchange = e => { choice.topic = e.target.value; };
    $("#interview-count").onchange = e => { choice.count = Number(e.target.value); };
    if ($("#interview-job")) $("#interview-job").onchange = e => { choice.jobId = e.target.value; };
    $("#interview-form").onsubmit = e => {
      e.preventDefault();
      if (!getConfig().interviewSources.available) { toast(t("请先上传简历并保存出题资料。")); return; }
      if (choice.type === "position" && !choice.jobId) { toast(t("请先在下方保存职位资料，再生成问题。")); return; }
      void startTask("/api/interviews", { ...choice, jobId: choice.type === "position" ? choice.jobId : undefined }, "interview");
    };
    bindMaterialsForm(); bindJobForm(); updateButtons();
  }
  async function refreshSources() {
    try {
      const [sources, response] = await Promise.all([api("/api/interview-sources"), api("/api/library")]);
      getConfig().interviewSources = sources; getState().library = response.items;
      if (location.hash === "#interview" && $("#interview-materials-panel") && !$("#interview-materials-form")?.contains(document.activeElement)) {
        $("#interview-materials-panel").innerHTML = materialsContent(); bindMaterialsForm();
      }
    } catch (error) { toast(error.message); }
  }
  function materialsForm() { return `<section class="card flat interview-job-panel" id="interview-materials-panel">${materialsContent()}</section>`; }
  function materialsContent() {
    const sources = getConfig().interviewSources, selected = sources.selection ?? { resume: [], personal: [], study: [] };
    const records = getState().library ?? [];
    return ui`<div class="section-heading interview-materials-heading"><div><h2>出题资料</h2><p class="card-subtitle">上传自己的资料后，为每份资料选择用途。至少选择一份简历。</p></div><a class="button flat" href="#library">上传资料 ↗</a></div>
      <p class="interview-materials-readiness" data-ready="${sources.available}"><span aria-hidden="true">${sources.available ? "✓" : "!"}</span>${escape(sources.available ? t("简历已就绪，可以生成问题。") : t("尚未选择可读取的简历；图片或扫描 PDF 请先在资料库整理。"))}</p>
      ${sources.legacy && sources.available ? t('<p class="interview-help">正在兼容读取本机原有资料目录；保存下方选择后，以所选资料为准。</p>') : ""}
      <form id="interview-materials-form"><div class="interview-materials-list">${records.map(item => {
        const role = Object.keys(selected).find(role => selected[role].includes(item.id)) ?? "none";
        return ui`<label class="interview-material-row" data-material-role="${role}"><span class="interview-material-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg></span><span class="interview-material-title">${escape(item.title)}</span><select data-material-id="${escape(item.id)}" aria-label="${escape(item.title + t("的用途"))}">${options({ none: t("不用于面试"), resume: t("简历 / 项目经历"), personal: t("本人案例"), study: t("技术学习材料") }, role)}</select></label>`;
      }).join("") || t('<p class="interview-materials-empty">资料库还是空的，请先上传 PDF 或 Markdown。</p>')}</div><div class="settings-actions interview-materials-actions"><span id="interview-materials-status" role="status"></span><button class="button primary" type="submit">保存出题资料</button></div></form>`;
  }
  function bindMaterialsForm() {
    if (!$("#interview-materials-form")) return;
    elements('[data-material-id]').forEach(select => select.onchange = () => {
      const row = select.parentElement;
      if (row) row.dataset.materialRole = (/** @type {HTMLSelectElement} */ (select)).value;
    });
    $("#interview-materials-form").onsubmit = async event => {
      event.preventDefault(); const selected = { resume: [], personal: [], study: [] }, button = event.submitter;
      elements('[data-material-id]').forEach(input => { if ((/** @type {HTMLInputElement} */ (input)).value !== "none") selected[(/** @type {HTMLInputElement} */ (input)).value].push(input.dataset.materialId); });
      button.disabled = true;
      try { getConfig().interviewSources = await api('/api/interview-sources', 'PUT', selected); if ($("#interview-materials-panel")) { $("#interview-materials-panel").innerHTML = materialsContent(); bindMaterialsForm(); $("#interview-materials-status").textContent = t("已保存到本机。"); } toast(t("出题资料已保存。")); }
      catch (error) { toast(error.message); }
      finally { if (button.isConnected) button.disabled = false; }
    };
  }
  function jobForm() {
    return ui`<section class="card flat interview-job-panel"><div class="section-heading"><div><h2>先输入这次的职位</h2><p class="card-subtitle">同一公司 / 职位可填写多个链接，也可以直接粘贴完整 JD。</p></div></div><form id="job-form" class="job-form"><div class="field"><label for="job-title">公司 / 职位名称</label><input id="job-title" maxlength="150" required placeholder="例如：某公司 · Mobile Engineer"></div><div class="field"><label for="job-urls">职位链接 · 每行一个，最多 5 个</label><textarea id="job-urls" rows="3" placeholder="https://…"></textarea></div><div class="field"><label for="job-description">职位原文 · 最多 60,000 字符</label><textarea id="job-description" rows="7" maxlength="60000" placeholder="粘贴职责、必须条件、技术栈、公司业务等原文…"></textarea></div><button class="button mint" type="submit" id="job-save">保存职位资料</button><p class="form-note" id="job-status" role="status">保存资料不调用模型；网页需要登录或无法读取时，请粘贴原文。</p></form><div class="saved-jobs">${jobs().slice().reverse().map(j => ui`<details><summary>${escape(j.title)} · ${j.sources.length} 份来源</summary>${j.warnings.map(w => `<p class="stale-note">${escape(w)}</p>`).join("")}${j.sources.map(s => `<details class="job-source"><summary>${escape(s.title)}${s.url ? ` · ${escape(s.url)}` : ""}</summary><p class="problem-copy">${escape(s.content)}</p></details>`).join("")}</details>`).join("")}</div></section>`;
  }
  function bindJobForm() {
    if (!$("#job-form")) return;
    $("#job-form").onsubmit = async e => {
      e.preventDefault(); const button = $("#job-save"), status = $("#job-status"); button.disabled = true;
      status.textContent = t("正在读取并保存职位资料…");
      try {
        const job = await api("/api/interview-jobs", "POST", { title: $("#job-title").value, urls: $("#job-urls").value.split(/\n/).map(s => s.trim()).filter(Boolean), description: $("#job-description").value });
        getState().interviewJobs ??= []; getState().interviewJobs.push(job); choice.jobId = job.id;
        // A completed import must not navigate away from another exercise.
        if (location.hash === "#interview" && choice.type === "position") renderGenerator();
        toast(job.warnings.length ? t("职位已保存，部分链接未取得正文；请查看来源说明。") : t("职位已保存，可以生成定制问题。"));
      } catch (error) { if (status.isConnected) status.textContent = error.message; toast(error.message); }
      finally { if (button.isConnected) button.disabled = false; }
    };
  }
  function renderWorkspace(set) {
    choice.type = set.type; choice.topic = set.topic; choice.count = set.count; choice.jobId = set.jobId ?? "";
    voicePractice.render(set);
  }
  function renderFeedback(set) { voicePractice.updateRecord(set); }
  function reviewCompleted() {}
  return { renderGenerator, renderWorkspace, renderFeedback, flush, dispose, remember, reviewCompleted, hasWorkspace: voicePractice.hasWorkspace };
}
