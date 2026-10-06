import { element, elements } from './dom.ts';
import { t, catalogText } from "./i18n.js";
import { createVoiceInterview } from "./interview-voice.js";
import { interviewTitle } from './interview-title.js';
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
    $("#page").innerHTML = pageHeading(t("chrome.makeYourPoint"), t("ui.tellYourStoryWithFocus"), t("ui.practiceCommonQuestionsTechnicalFollowUpsAndJob")) + `
      <div class="interview-modes" role="group" aria-label="${t("ui.interviewPracticeType")}">${Object.entries(config.interviewTypes).map(([id, label]) => `<button type="button" class="button ${choice.type === id ? "pressed selected" : "flat"}" data-interview-type="${id}" aria-pressed="${choice.type === id}">${escape(catalogText(label))}</button>`).join("")}</div>
      <section class="language-generator interview-generator"><div class="card flat"><div class="section-heading"><div><h2>${t("ui.prepareInterviewQuestions")}</h2><p class="card-subtitle">${t("ui.prepareTheQuestionsThenPracticeTheVoiceInterview")}</p></div></div><form id="interview-form" class="generator-form">
        <div class="field"><label for="interview-topic">${t("ui.practiceArea")}</label><select id="interview-topic">${options(config.interviewTopics[choice.type], choice.topic)}</select></div>
        <div class="field"><label for="interview-count">${t("ui.questionsPerSet")}</label><select id="interview-count">${options({ 3: t("ui.questionsFocused"), 5: t("ui.questionsStandard"), 8: t("ui.questionsComprehensive") }, String(choice.count))}</select></div>
        ${choice.type === "position" ? `<div class="field"><label for="interview-job">${t("ui.companyJobInformation")}</label><select id="interview-job">${options(Object.fromEntries(jobs().map(j => [j.id, j.title])), choice.jobId, t("ui.chooseASavedJob"))}</select></div>` : ""}
        <button class="button primary" type="submit" data-ai>${t("ui.generateInterviewQuestions")}</button><p class="form-note">${t("ui.theModelAtTheTopPreparesQuestionsDuring")}</p></form></div>
      <div class="card flat language-intro"><span class="eyebrow">${t("chrome.conclusionFirst")}</span><h2>${t("ui.leadWithYourConclusionThenYourKeyActions")}</h2><ol><li>${t("ui.listenToTheCodexQuestionShowAnswerHints")}</li><li>${t("ui.answerAloudStateYourConclusionFirstThenExplain")}</li><li>${t("ui.hearSpecificFeedbackOnBackgroundYouCanOmit")}</li></ol><p>${escape(config.interviewSources.available ? t("ui.yourResumeAndSelectedDocumentsAreConnectedStudy") : t("ui.uploadYourOwnResumeAndSelectInterviewDocuments"))}</p><details class="interview-source-list"><summary>${t("ui.viewQuestionSources")}</summary>${list(config.interviewSources.files)}</details></div></section>
      ${materialsForm()}
      ${choice.type === "position" ? jobForm() : ""}
      <section class="language-history"><div class="section-heading"><div><h2>${t("ui.interviewPracticeHistory")}</h2><p class="card-subtitle">${t("ui.saveQuestionsVoiceAnswerTranscriptsAndFeedbackPrevious")}</p></div></div>${sets().filter(s => s.type === choice.type).reverse().map(s => `<a class="history-item flat" href="#interview/${s.id}"><div><h3 class="history-title">${escape(interviewTitle(s))}</h3><div class="tags"><span class="tag">${t("interview.questions", { length: s.questions.length })}</span>${s.jobTitle ? `<span class="tag">${escape(s.jobTitle)}</span>` : ""}</div><div class="history-meta">${t("interview.voiceSessionsTextFeedbackSessions", { value5: date(s.updatedAt), length: (s.voiceAttempts ?? []).length, length7: s.reviews.length })}</div></div><span class="history-arrow">↗</span></a>`).join("") || `<div class="card flat empty-small">${t("ui.noPracticeOfThisTypeYetGenerateA")}</div>`}</section>`;
    elements("[data-interview-type]").forEach(button => button.onclick = () => { choice.type = button.dataset.interviewType; choice.topic = "all"; renderGenerator(); });
    $("#interview-topic").onchange = e => { choice.topic = e.target.value; };
    $("#interview-count").onchange = e => { choice.count = Number(e.target.value); };
    if ($("#interview-job")) $("#interview-job").onchange = e => { choice.jobId = e.target.value; };
    $("#interview-form").onsubmit = e => {
      e.preventDefault();
      if (!getConfig().interviewSources.available) { toast(t("ui.uploadAResumeAndSaveTheDocumentSelection")); return; }
      if (choice.type === "position" && !choice.jobId) { toast(t("ui.saveJobInformationBelowBeforeGeneratingQuestions")); return; }
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
    return `<div class="section-heading interview-materials-heading"><div><h2>${t("ui.interviewDocuments")}</h2><p class="card-subtitle">${t("ui.uploadYourDocumentsAndSelectAPurposeFor")}</p></div><a class="button flat" href="#library">${t("ui.uploadMaterials")}</a></div>
      <p class="interview-materials-readiness" data-ready="${sources.available}"><span aria-hidden="true">${sources.available ? "✓" : "!"}</span>${escape(sources.available ? t("ui.yourResumeIsReadyYouCanGenerateQuestions") : t("ui.noReadableResumeSelectedOrganizeImagesOrScanned"))}</p>
      ${sources.legacy && sources.available ? `<p class="interview-help">${t("ui.usingYourExistingLocalDocumentDirectoryForCompatibility")}</p>` : ""}
      <form id="interview-materials-form"><div class="interview-materials-list">${records.map(item => {
        const role = Object.keys(selected).find(role => selected[role].includes(item.id)) ?? "none";
        return `<label class="interview-material-row" data-material-role="${role}"><span class="interview-material-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg></span><span class="interview-material-title">${escape(item.title)}</span><select data-material-id="${escape(item.id)}" aria-label="${escape(item.title + t("ui.purpose"))}">${options({ none: t("ui.excludeFromInterviews"), resume: t("ui.resumeProjectExperience"), personal: t("ui.personalExamples"), study: t("ui.technicalStudyMaterial") }, role)}</select></label>`;
      }).join("") || `<p class="interview-materials-empty">${t("ui.yourLibraryIsEmptyUploadAPDFOr")}</p>`}</div><div class="settings-actions interview-materials-actions"><span id="interview-materials-status" role="status"></span><button class="button primary" type="submit">${t("ui.saveInterviewDocuments")}</button></div></form>`;
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
      try { getConfig().interviewSources = await api('/api/interview-sources', 'PUT', selected); if ($("#interview-materials-panel")) { $("#interview-materials-panel").innerHTML = materialsContent(); bindMaterialsForm(); $("#interview-materials-status").textContent = t("ui.savedOnThisComputer"); } toast(t("ui.interviewDocumentSelectionSaved")); }
      catch (error) { toast(error.message); }
      finally { if (button.isConnected) button.disabled = false; }
    };
  }
  function jobForm() {
    return `<section class="card flat interview-job-panel"><div class="section-heading"><div><h2>${t("ui.startWithThisJob")}</h2><p class="card-subtitle">${t("ui.addMultipleLinksForOneCompanyRoleOr")}</p></div></div><form id="job-form" class="job-form"><div class="field"><label for="job-title">${t("ui.companyRoleName")}</label><input id="job-title" maxlength="150" required placeholder="${t("ui.forExampleCompanyMobileEngineer")}"></div><div class="field"><label for="job-urls">${t("ui.jobLinksOnePerLineUpTo")}</label><textarea id="job-urls" rows="3" placeholder="https://…"></textarea></div><div class="field"><label for="job-description">${t("ui.jobDescriptionUpToCharacters")}</label><textarea id="job-description" rows="7" maxlength="60000" placeholder="${t("ui.pasteResponsibilitiesRequirementsStackAndBusinessDescription")}"></textarea></div><button class="button mint" type="submit" id="job-save">${t("ui.saveJobInformation")}</button><p class="form-note" id="job-status" role="status">${t("ui.savingDoesNotCallAIPasteTheText")}</p></form><div class="saved-jobs">${jobs().slice().reverse().map(j => `<details><summary>${t("interview.sources", { value1: escape(j.title), length: j.sources.length })}</summary>${j.warnings.map(w => `<p class="stale-note">${escape(w)}</p>`).join("")}${j.sources.map(s => `<details class="job-source"><summary>${escape(s.title)}${s.url ? ` · ${escape(s.url)}` : ""}</summary><p class="problem-copy">${escape(s.content)}</p></details>`).join("")}</details>`).join("")}</div></section>`;
  }
  function bindJobForm() {
    if (!$("#job-form")) return;
    $("#job-form").onsubmit = async e => {
      e.preventDefault(); const button = $("#job-save"), status = $("#job-status"); button.disabled = true;
      status.textContent = t("ui.readingAndSavingJobInformation");
      try {
        const job = await api("/api/interview-jobs", "POST", { title: $("#job-title").value, urls: $("#job-urls").value.split(/\n/).map(s => s.trim()).filter(Boolean), description: $("#job-description").value });
        getState().interviewJobs ??= []; getState().interviewJobs.push(job); choice.jobId = job.id;
        // A completed import must not navigate away from another exercise.
        if (location.hash === "#interview" && choice.type === "position") renderGenerator();
        toast(job.warnings.length ? t("ui.jobSavedSomeLinksCouldNotBeRead") : t("ui.jobSavedYouCanGenerateTailoredQuestions"));
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
