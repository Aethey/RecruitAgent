import { element, elements } from './dom.ts';
import { t, ui } from "./i18n.js";
import { mountReference } from "./editor.js";

/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createLanguagePractice({ $, escape, date, options, pageHeading, list, getConfig, getState, mountDraft, flushCode, api, toast, startTask, updateButtons }) {
  const choice = { language: "dart", topic: "auto" };
  let disposeReference = null;
  function dispose() { disposeReference?.(); disposeReference = null; }
  const drills = () => getState().languageDrills ?? [];
  const syllabus = () => getConfig().languageSyllabus[choice.language];
  const filename = language => ({ dart: "practice.dart", kotlin: "Practice.kt", swift: "Practice.swift", python: "practice.py", go: "practice.go", java: "Practice.java", javascript: "practice.js", typescript: "practice.ts" })[language];
  function coverage(id, spec) {
    const covered = new Set(drills().filter(d => d.language === choice.language && d.topic === id).flatMap(d => d.concepts));
    return spec.concepts.filter(c => covered.has(c)).length;
  }
  function renderGenerator() {
    dispose();
    const config = getConfig(), catalog = syllabus();
    $("#page").innerHTML = pageHeading("WRITE THE LANGUAGE", t("把常用写法，练成习惯。"), t("自己写一遍，再对照正确模板，理解每一种写法。")) + ui`
      <section class="language-generator">
        <div class="card flat"><div class="section-heading"><div><h2>今天，巩固哪种语言？</h2><p class="card-subtitle">基础成组练，关键写法放在一起比较。</p></div><span class="section-number">01 / WRITE</span></div>
          <form id="language-form" class="generator-form">
            <div class="field"><label for="drill-language">练习语言</label><select id="drill-language">${options(config.languages, choice.language)}</select></div>
            <div class="field"><label for="drill-topic">练习方向</label><select id="drill-topic"><option value="auto" ${choice.topic === "auto" ? "selected" : ""}>全面轮练 · 优先未覆盖的知识点</option>${options(Object.fromEntries(Object.entries(catalog).map(([id, s]) => [id, s.label])), choice.topic)}</select></div>
            <button class="button primary" type="submit" data-ai>✧ 出一组练习 →</button>
            <p class="form-note">每组由模型组合相关写法，生成时一并准备参考模板与讲解。</p>
          </form>
        </div>
        <div class="card flat language-intro"><span class="eyebrow">LEARN BY WRITING</span><h2>知道怎么写，也知道为什么。</h2><ol><li>按题目写变量、集合、函数或完整的小例子。</li><li>点击「查看模板与讲解」，直接对照参考代码。</li><li>理解写法的好处、适用场景和容易踩的坑。</li></ol><p>点击查看不再请求 Codex；生成练习使用顶部所选模型。</p></div>
      </section>
      <section class="card flat syllabus-panel"><div class="section-heading"><div><h2>${escape(config.languages[choice.language])} · 写法覆盖目录</h2><p class="card-subtitle">覆盖数量表示已经出过题，不等于已经掌握。</p></div><span class="section-number">${Object.values(catalog).reduce((n, s) => n + s.concepts.length, 0)} 个知识点</span></div><div class="syllabus-grid">${Object.entries(catalog).map(([id, spec]) => `<article class="syllabus-topic"><button type="button" data-drill-topic="${id}" class="syllabus-heading ${choice.topic === id ? "selected" : ""}">${escape(t(spec.label))}<span>${coverage(id, spec)} / ${spec.concepts.length}</span></button><p>${escape(spec.concepts.map(value => t(value)).join(" · "))}</p></article>`).join("")}</div></section>
      <section class="language-history"><div class="section-heading"><div><h2>${escape(config.languages[choice.language])} · 练习记录</h2><p class="card-subtitle">继续写代码，或回看模板与讲解。</p></div></div><div id="language-history-list">${drills().filter(d => d.language === choice.language).reverse().map(d => ui`<a class="history-item flat" href="#language/${d.id}"><div><h3 class="history-title">${escape(d.title)}</h3><div class="tags"><span class="tag">${escape(catalog[d.topic]?.label ?? d.topic)}</span><span class="tag">${d.exercises.length} 个小练习</span></div><div class="history-meta">${date(d.updatedAt)} · ${d.revealedAt ? t("已查看模板") : t("模板待查看")}</div></div><span class="history-arrow">↗</span></a>`).join("") || t('<div class="card flat empty-small">还没有这门语言的练习记录，先出一组试试。</div>')}</div></section>`;
    $("#drill-language").onchange = event => { choice.language = event.target.value; choice.topic = "auto"; renderGenerator(); };
    $("#drill-topic").onchange = event => { choice.topic = event.target.value; };
    $("#language-form").onsubmit = event => { event.preventDefault(); void startTask("/api/language-drills", { ...choice }, "language"); };
    elements("[data-drill-topic]").forEach(button => button.onclick = () => { choice.topic = button.dataset.drillTopic; renderGenerator(); });
    updateButtons();
  }
  function renderWorkspace(drill) {
    dispose();
    const config = getConfig(), spec = config.languageSyllabus[drill.language][drill.topic];
    choice.language = drill.language; choice.topic = drill.selectionTopic ?? "auto";
    $("#page").innerHTML = pageHeading("LANGUAGE PRACTICE", t("让写法，成为习惯。"), t("先自己写，想对照时直接打开模板与讲解。"), t('<a class="button flat" href="#language">选择下一组 ＋</a>')) + ui`
      <section class="workspace language-workspace">
        <article class="card flat problem-panel"><div class="tags"><span class="tag">${escape(config.languages[drill.language])}</span><span class="tag">${escape(t(spec.label))}</span><span class="tag">${drill.exercises.length} 个小练习</span></div><h2>${escape(drill.title)}</h2><p class="problem-copy">${escape(drill.introduction)}</p><div class="drill-exercises">${drill.exercises.map((exercise, i) => `<article class="drill-exercise"><span class="eyebrow">EXERCISE ${String(i + 1).padStart(2, "0")}</span><h3>${escape(exercise.title)}</h3><p class="problem-copy">${escape(exercise.instruction)}</p><div class="concept-label">${escape(exercise.concepts.map(value => t(value)).join(" · "))}</div></article>`).join("")}</div><h3 class="subheading">版本与环境</h3>${list(drill.requirements)}</article>
        <div><section class="card flat editor-panel"><div class="editor-toolbar"><span class="language-label">⌘ ${filename(drill.language)}</span><button id="save-state" class="save-state" type="button">已保存到本机 ✓</button></div><div class="code-wrap monaco-wrap"><div id="code-editor" class="monaco-host"></div></div><p class="editor-footnote">自动缩进 · 括号匹配 · 自动保存</p><div class="editor-actions"><button id="reveal-template" class="button mint">${drill.revealedAt ? t("收起模板与讲解") : t("查看模板与讲解")}</button><button id="next-language-drill" class="button primary" data-ai>再来一组 →</button></div></section><section id="language-reference" class="card flat language-reference" ${drill.revealedAt ? "" : "hidden"}></section></div>
      </section>`;
    mountDraft(drill, filename(drill.language));
    $("#save-state").onclick = () => { void flushCode().catch(error => toast(error.message)); };
    $("#next-language-drill").onclick = () => { void startTask("/api/language-drills", { ...choice }, "language"); };
    $("#reveal-template").onclick = async () => {
      const panel = $("#language-reference"), button = $("#reveal-template");
      if (!panel.hidden) { dispose(); panel.hidden = true; button.textContent = t("查看模板与讲解"); return; }
      button.disabled = true;
      try {
        await flushCode();
        const result = await api(`/api/language-drills/${drill.id}/reveal`, "POST", {});
        const record = drills().find(d => d.id === drill.id); if (record) record.revealedAt = result.revealedAt;
        // Navigation can finish while this save is pending.
        if (location.hash !== `#language/${drill.id}`) return;
        showReference(drill); button.textContent = t("收起模板与讲解");
      } catch (error) { toast(error.message); }
      finally { if (button.isConnected) button.disabled = false; }
    };
    if (drill.revealedAt) showReference(drill);
  }
  function showReference(drill) {
    dispose();
    const panel = $("#language-reference"); panel.hidden = false;
    panel.innerHTML = ui`<div class="section-heading"><div><h2>正确模板与讲解</h2><p class="card-subtitle">对照你的代码，理解每一个选择。</p></div></div><div class="code-wrap monaco-wrap"><div id="reference-editor" class="monaco-host reference-host"></div></div>${drill.exercises.map((exercise, i) => ui`<article class="template-explanation"><span class="eyebrow">EXERCISE ${String(i + 1).padStart(2, "0")}</span><h3>${escape(exercise.title)}</h3><h4>怎么写，为什么这样写</h4><p>${escape(exercise.explanation)}</p><h4>好处与适用场景</h4>${list(exercise.benefits)}${exercise.pitfalls.length ? ui`<h4>边界与容易踩的坑</h4>${list(exercise.pitfalls)}` : ""}</article>`).join("")}<p class="evaluation-note">参考模板由模型生成，未在这里编译执行；版本与依赖见题目说明。</p>`;
    disposeReference = mountReference($("#reference-editor"), { language: drill.language, value: drill.templateCode });
  }
  return { renderGenerator, renderWorkspace, dispose };
}
