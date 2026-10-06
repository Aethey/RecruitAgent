import { element, elements } from './dom.ts';
import { t, catalogText } from "./i18n.js";
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
    $("#page").innerHTML = pageHeading(t("chrome.writeTheLanguage"), t("ui.makeUsefulPatternsAHabit"), t("ui.writeItYourselfThenCompareWithTheTemplate")) + `
      <section class="language-generator">
        <div class="card flat"><div class="section-heading"><div><h2>${t("ui.whichLanguageToday")}</h2><p class="card-subtitle">${t("ui.practiceBasicsTogetherAndCompareImportantPatterns")}</p></div><span class="section-number">${t("chrome.write")}</span></div>
          <form id="language-form" class="generator-form">
            <div class="field"><label for="drill-language">${t("ui.practiceLanguage")}</label><select id="drill-language">${options(config.languages, choice.language)}</select></div>
            <div class="field"><label for="drill-topic">${t("ui.practiceArea")}</label><select id="drill-topic"><option value="auto" ${choice.topic === "auto" ? "selected" : ""}>${t("ui.mixedPracticePrioritizeUncoveredPoints")}</option>${options(Object.fromEntries(Object.entries(catalog).map(([id, s]) => [id, s.label])), choice.topic)}</select></div>
            <button class="button primary" type="submit" data-ai>${t("ui.generateAPracticeSet")}</button>
            <p class="form-note">${t("ui.theModelGroupsRelatedPatternsAndPreparesTemplates")}</p>
          </form>
        </div>
        <div class="card flat language-intro"><span class="eyebrow">${t("chrome.learnByWriting")}</span><h2>${t("ui.knowHowToWriteItAndWhy")}</h2><ol><li>${t("ui.writeVariablesCollectionsFunctionsOrSmallCompleteExamples")}</li><li>${t("ui.openTheTemplateAndExplanationToCompareReference")}</li><li>${t("ui.understandTheBenefitsUseCasesAndPitfalls")}</li></ol><p>${t("ui.viewingDoesNotCallCodexAgainGenerationUses")}</p></div>
      </section>
      <section class="card flat syllabus-panel"><div class="section-heading"><div><h2>${t("language.patternCoverage", { value4: escape(config.languages[choice.language]) })}</h2><p class="card-subtitle">${t("ui.coverageMeansAPointHasBeenIncludedNot")}</p></div><span class="section-number">${t("language.knowledgePoints", { value5: Object.values(catalog).reduce((n, s) => n + s.concepts.length, 0) })}</span></div><div class="syllabus-grid">${Object.entries(catalog).map(([id, spec]) => `<article class="syllabus-topic"><button type="button" data-drill-topic="${id}" class="syllabus-heading ${choice.topic === id ? "selected" : ""}">${escape(catalogText(spec.label))}<span>${coverage(id, spec)} / ${spec.concepts.length}</span></button><p>${escape(spec.concepts.map(value => catalogText(value)).join(" · "))}</p></article>`).join("")}</div></section>
      <section class="language-history"><div class="section-heading"><div><h2>${t("language.practiceHistory", { value7: escape(config.languages[choice.language]) })}</h2><p class="card-subtitle">${t("ui.continueCodingOrRevisitTemplatesAndExplanations")}</p></div></div><div id="language-history-list">${drills().filter(d => d.language === choice.language).reverse().map(d => `<a class="history-item flat" href="#language/${d.id}"><div><h3 class="history-title">${escape(d.title)}</h3><div class="tags"><span class="tag">${escape(catalogText(catalog[d.topic]?.label ?? d.topic))}</span><span class="tag">${t("language.smallExercises", { length: d.exercises.length })}</span></div><div class="history-meta">${date(d.updatedAt)} · ${d.revealedAt ? t("ui.templateViewed") : t("ui.templateNotViewed")}</div></div><span class="history-arrow">↗</span></a>`).join("") || `<div class="card flat empty-small">${t("ui.noPracticeForThisLanguageYetGenerateA")}</div>`}</div></section>`;
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
    $("#page").innerHTML = pageHeading(t("chrome.languagePractice"), t("ui.makeThePatternsAHabit"), t("ui.writeFirstThenOpenTheTemplateAndExplanation"), `<a class="button flat" href="#language">${t("ui.chooseNextSet")}</a>`) + `
      <section class="workspace language-workspace">
        <article class="card flat problem-panel"><div class="tags"><span class="tag">${escape(config.languages[drill.language])}</span><span class="tag">${escape(catalogText(spec.label))}</span><span class="tag">${t("language.smallExercises", { length: drill.exercises.length })}</span></div><h2>${escape(drill.title)}</h2><p class="problem-copy">${escape(drill.introduction)}</p><div class="drill-exercises">${drill.exercises.map((exercise, i) => `<article class="drill-exercise"><span class="eyebrow">${t("chrome.exercise")} ${String(i + 1).padStart(2, "0")}</span><h3>${escape(exercise.title)}</h3><p class="problem-copy">${escape(exercise.instruction)}</p><div class="concept-label">${escape(exercise.concepts.map(value => catalogText(value)).join(" · "))}</div></article>`).join("")}</div><h3 class="subheading">${t("ui.versionAndEnvironment")}</h3>${list(drill.requirements)}</article>
        <div><section class="card flat editor-panel"><div class="editor-toolbar"><span class="language-label">⌘ ${filename(drill.language)}</span><button id="save-state" class="save-state" type="button">${t("ui.savedLocally")}</button></div><div class="code-wrap monaco-wrap"><div id="code-editor" class="monaco-host"></div></div><p class="editor-footnote">${t("ui.autoIndentBracketMatchingAutoSave")}</p><div class="editor-actions"><button id="reveal-template" class="button mint">${drill.revealedAt ? t("ui.hideTemplateAndExplanation") : t("ui.viewTemplateAndExplanation")}</button><button id="next-language-drill" class="button primary" data-ai>${t("ui.anotherSet")}</button></div></section><section id="language-reference" class="card flat language-reference" ${drill.revealedAt ? "" : "hidden"}></section></div>
      </section>`;
    mountDraft(drill, filename(drill.language));
    $("#save-state").onclick = () => { void flushCode().catch(error => toast(error.message)); };
    $("#next-language-drill").onclick = () => { void startTask("/api/language-drills", { ...choice }, "language"); };
    $("#reveal-template").onclick = async () => {
      const panel = $("#language-reference"), button = $("#reveal-template");
      if (!panel.hidden) { dispose(); panel.hidden = true; button.textContent = t("ui.viewTemplateAndExplanation"); return; }
      button.disabled = true;
      try {
        await flushCode();
        const result = await api(`/api/language-drills/${drill.id}/reveal`, "POST", {});
        const record = drills().find(d => d.id === drill.id); if (record) record.revealedAt = result.revealedAt;
        // Navigation can finish while this save is pending.
        if (location.hash !== `#language/${drill.id}`) return;
        showReference(drill); button.textContent = t("ui.hideTemplateAndExplanation");
      } catch (error) { toast(error.message); }
      finally { if (button.isConnected) button.disabled = false; }
    };
    if (drill.revealedAt) showReference(drill);
  }
  function showReference(drill) {
    dispose();
    const panel = $("#language-reference"); panel.hidden = false;
    panel.innerHTML = `<div class="section-heading"><div><h2>${t("ui.referenceTemplateAndExplanation")}</h2><p class="card-subtitle">${t("ui.compareYourCodeAndUnderstandEachChoice")}</p></div></div><div class="code-wrap monaco-wrap"><div id="reference-editor" class="monaco-host reference-host"></div></div>${drill.exercises.map((exercise, i) => `<article class="template-explanation"><span class="eyebrow">${t("chrome.exercise")} ${String(i + 1).padStart(2, "0")}</span><h3>${escape(exercise.title)}</h3><h4>${t("ui.howToWriteItAndWhy")}</h4><p>${escape(exercise.explanation)}</p><h4>${t("ui.benefitsAndUseCases")}</h4>${list(exercise.benefits)}${exercise.pitfalls.length ? `<h4>${t("ui.boundariesAndPitfalls")}</h4>${list(exercise.pitfalls)}` : ""}</article>`).join("")}<p class="evaluation-note">${t("ui.templatesAreAIGeneratedAndNotCompiledHere")}</p>`;
    disposeReference = mountReference($("#reference-editor"), { language: drill.language, value: drill.templateCode });
  }
  return { renderGenerator, renderWorkspace, dispose };
}
