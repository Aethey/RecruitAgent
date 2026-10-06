import { element, elements } from './dom.ts';
import { t, catalogText, errorText } from "./i18n.js";
import { interviewTitle } from './interview-title.js';
import { editorValue, mountEditor, mountReference } from "./editor.js";
/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
function createTrainingPractice({ $, escape, date, options, pageHeading, list, api, toast, startTask, updateButtons, getState, getConfig, flushBefore }) {
  let mountedId = null, draft = {}, timer = null, queue = Promise.resolve(), reviewId = null, referenceDispose = null, hubKind = "compression", rows = 1, pendingFocus = "";
  const records = () => getState().trainings ?? [];
  const record = () => records().find((r) => r.id === mountedId);
  const key = (id) => `algo-practice:training:${id}`;
  function remember() {
    if (mountedId) try {
      localStorage.setItem(key(mountedId), JSON.stringify(draft));
    } catch {
    }
  }
  function badge(value, failed = false) {
    const el = $("#training-save");
    if (el) {
      el.textContent = value;
      el.classList.toggle("failed", failed);
    }
  }
  async function save(id, snapshot) {
    remember();
    const op = queue.catch(() => {
    }).then(async () => {
      await api(`/api/trainings/${id}`, "PUT", { draft: snapshot });
      const r = records().find((r2) => r2.id === id);
      if (r) Object.assign(r.draft, snapshot);
      try {
        if (localStorage.getItem(key(id)) === JSON.stringify(snapshot)) localStorage.removeItem(key(id));
      } catch {
      }
      if (id === mountedId && JSON.stringify(snapshot) === JSON.stringify(draft)) badge(t("ui.savedLocally"));
    });
    queue = op;
    try {
      await op;
    } catch (e) {
      if (id === mountedId) badge(t("ui.saveFailedClickToRetry"), true);
      throw e;
    }
  }
  async function flush() {
    clearTimeout(timer);
    if (mountedId && JSON.stringify(record()?.draft) !== JSON.stringify(draft)) await save(mountedId, { ...draft });
    await queue;
  }
  function change(field2, value) {
    draft[field2] = value;
    remember();
    badge(t("ui.saving"));
    clearTimeout(timer);
    timer = setTimeout(() => void save(mountedId, { ...draft }).catch(() => {
    }), 650);
    updateStale();
  }
  function dispose() {
    clearTimeout(timer);
    referenceDispose?.();
    referenceDispose = null;
    mountedId = null;
    draft = {};
    reviewId = null;
  }
  async function begin(input) {
    try {
      await flushBefore();
      const r = await api("/api/trainings", "POST", input);
      getState().trainings ??= [];
      getState().trainings.push(r);
      location.hash = `training/${r.id}`;
    } catch (e) {
      toast(e.message);
    }
  }
  function fieldLabel(name) {
    const labels = { original: t("ui.originalAnswer2"), points: t("ui.condensedKeyPoints"), code: t("ui.fixedCode"), cause: t("ui.rootCause"), checks: t("ui.validationPlan"), company: t("ui.company"), role: t("ui.role"), date: t("ui.interviewDate"), stage: t("ui.round"), notes: t("ui.overallFeedbackAndObservations") };
    if (labels[name]) return labels[name];
    const [kind, id] = name.split(":");
    const entryLabels = { question: t("ui.actualQuestion"), answer: t("ui.myAnswer"), feedback: t("ui.explicitInterviewerFeedback") };
    return entryLabels[kind] ? `${t("training.question3", { id: id, value2: entryLabels[kind] })}` : name;
  }
  const field = (name, label, value = "", placeholder = "", rows2 = 5) => `<div class="field"><label for="training-${escape(name)}">${escape(label)}</label><textarea id="training-${escape(name)}" data-training-field="${escape(name)}" rows="${rows2}" maxlength="10000" placeholder="${escape(placeholder)}">${escape(value)}</textarea></div>`;
  /** @param {ParentNode} root */
  function bindFields(root = document) {
    elements("[data-training-field]", root).forEach((el) => el.oninput = () => change(el.dataset.trainingField, (/** @type {HTMLInputElement} */ (el)).value));
  }
  function renderHub(preset) {
    dispose();
    if (Object.hasOwn(getConfig().trainingKinds, preset)) hubKind = preset;
    const config = getConfig();
    $("#page").innerHTML = pageHeading(t("chrome.practiceWithPurpose"), t("ui.turnPracticeIntoYourNextImprovement"), t("ui.focusAnswersExploreReasonsAndDiagnoseBugsThen")) + `<div class="training-modes" role="group" aria-label="${t("ui.trainingType")}">${Object.entries(config.trainingKinds).map(([k, v]) => `<button class="button ${k === hubKind ? "pressed selected" : "flat"}" data-training-kind="${k}" aria-pressed="${k === hubKind}">${escape(catalogText(v))}</button>`).join("")}</div><section class="card flat training-generator" id="training-generator"></section><section class="language-history training-history"><div class="section-heading"><h2>${t("ui.trainingHistory")}</h2><span class="tag">${t("training.records", { length: records().filter((r) => r.kind === hubKind).length })}</span></div>${records().filter((r) => r.kind === hubKind).slice().reverse().map((r) => `<a class="history-item flat" href="#training/${r.id}"><div><h3 class="history-title">${escape(errorText(r.title))}</h3><div class="history-meta">${date(r.updatedAt)} · ${r.kind === "followup" ? `${t("training.followUpQuestions", { length: r.turns.length })}` : `${t("training.submissions", { length: r.reviews.length })}`}</div></div><span>↗</span></a>`).join("") || `<div class="card flat empty-small">${t("ui.noTrainingOfThisTypeYetStartA")}</div>`}</section>`;
    elements("[data-training-kind]").forEach((b) => b.onclick = () => {
      hubKind = b.dataset.trainingKind;
      const nextHash = `#training/${hubKind}`;
      if (location.hash === nextHash) renderHub(hubKind);
      else location.hash = nextHash;
    });
    const host = $("#training-generator");
    if (hubKind === "diagnosis") {
      host.innerHTML = `<h2>${t("ui.diagnoseAnEngineeringBug")}</h2><p class="interview-help">${t("ui.readSymptomsLocateTheCauseFixTheCode")}</p><form id="diagnosis-form" class="generator-form"><div class="training-form-grid"><div class="field"><label for="diagnosis-language">${t("ui.language")}</label><select id="diagnosis-language">${options(config.languages, "dart")}</select></div><div class="field"><label for="diagnosis-topic">${t("ui.bugCategory")}</label><select id="diagnosis-topic">${options(config.diagnosisTopics, "state")}</select></div></div>${field("focus", t("ui.scenarioToStrengthenOptional"), pendingFocus, t("ui.forExampleAsynchronousRequestsFinishOutOfOrder"), 3)}<button class="button primary" data-ai type="submit">${t("ui.generateADebuggingExercise")}</button><p class="form-note">${t("ui.aITeachingScenarioAndStaticReviewCodeIs")}</p></form>`;
      $("#diagnosis-form").onsubmit = (e) => {
        e.preventDefault();
        void startTask("/api/trainings/diagnosis", { language: $("#diagnosis-language").value, topic: $("#diagnosis-topic").value, focus: $("#training-focus").value }, "training");
      };
    } else if (hubKind === "debrief") {
      host.innerHTML = `<h2>${t("ui.recordARecentInterview")}</h2><p class="problem-copy">${t("ui.recordQuestionsYourAnswersAndReceivedFeedbackAI")}</p><button class="button mint" id="new-debrief">${t("ui.newInterviewDebrief")}</button><p class="form-note">${t("ui.creatingAndSavingDoesNotCallAIAnalysis")}</p>`;
      $("#new-debrief").onclick = () => void begin({ kind: "debrief" });
    } else {
      const sets = getState().interviews ?? [], qs = sets.flatMap((s) => s.questions.map((q) => ({ value: `${s.id}/${q.id}`, label: `${interviewTitle(s)} · ${q.question}` })));
      host.innerHTML = `<h2>${hubKind === "compression" ? t("ui.condenseAnswersToKeyPoints") : t("ui.goDeeperFromOneAnswer")}</h2><p class="interview-help">${hubKind === "compression" ? t("ui.reviewTheOriginalCondenseItYourselfIntoPoints") : t("ui.oneFocusedFollowUpPerAnswerUpTo")}</p><form id="start-training-form" class="generator-form"><div class="field"><label for="training-source-question">${t("ui.chooseAnExistingInterviewQuestion")}</label><select id="training-source-question">${options(Object.fromEntries(qs.map((q) => [q.value, q.label])), "", t("ui.enterAQuestionManually"))}</select></div><div id="manual-training">${field("question", t("ui.interviewQuestion"), "", t("ui.forExampleWhyDidYouChooseThisDesign"), 2)}${field("original", t("ui.yourOriginalAnswerOptionalForFollowUps"), "", t("ui.keepWhatYouWouldActuallySayWriteIt"), 6)}</div><button type="submit" class="button primary">${t("ui.startThisTraining")}</button><p class="form-note">${t("ui.creatingAndSavingDoesNotCallAIExisting")}</p></form>`;
      $("#training-source-question").onchange = (e) => {
        $("#manual-training").hidden = !!e.target.value;
      };
      $("#start-training-form").onsubmit = (e) => {
        e.preventDefault();
        const source = $("#training-source-question").value;
        if (source) {
          const [interviewId, questionId] = source.split("/");
          void begin({ kind: hubKind, interviewId, questionId });
        } else void begin({ kind: hubKind, question: $("#training-question").value, original: $("#training-original").value || void 0 });
      };
    }
    updateButtons();
  }
  function renderWorkspace(r) {
    mountedId = r.id;
    draft = { ...r.draft };
    reviewId = null;
    try {
      const local = JSON.parse(localStorage.getItem(key(r.id)) ?? "null");
      if (local && typeof local === "object") {
        for (const [k, v] of Object.entries(local)) if (typeof v === "string") draft[k] = v;
      }
    } catch {
    }
    $("#page").innerHTML = pageHeading(t("chrome.focusedPractice"), escape(errorText(r.title)), catalogText(getConfig().trainingKinds[r.kind]), `<a class="button flat" href="#training">${t("ui.backToSkillsTraining")}</a>`) + `<div class="interview-actions"><button id="training-save" class="save-state">${t("ui.savedLocally")}</button><span class="interview-help">${t("ui.eachSubmissionKeepsASnapshotYouCanEdit")}</span></div><section id="training-workspace"></section><section id="training-feedback"></section>${r.kind === "diagnosis" ? `<section id="diagnosis-reference"></section>` : ""}`;
    const host = $("#training-workspace");
    if (r.kind === "compression") host.innerHTML = `<article class="card flat"><h2>${t("ui.originalAndCondensedAnswers")}</h2><div class="training-form-grid">${field("original", t("ui.originalAnswer"), draft.original, t("ui.keepTheCompleteOriginalAnswer"), 10)}${field("points", t("ui.yourCondensedPoints"), draft.points, t("ui.onePointPerLineLinesUpToCharacters"), 10)}</div><div class="training-actions"><button class="button flat" data-ai id="compression-analyze">${t("ui.analyzeOriginalAnswer")}</button><button class="button primary" data-ai id="compression-rewrite">${t("ui.reviewMyCondensedAnswer")}</button></div><p class="interview-help">${t("ui.keepFactsAndKeyCausesRemoveRepetitionAnd")}</p></article>`;
    if (r.kind === "followup") host.innerHTML = `<div id="training-turns" class="training-turns"></div><div id="training-followup-end"></div>`;
    if (r.kind === "diagnosis") host.innerHTML = `<div class="training-diagnosis-grid"><article class="card flat"><h2>${t("ui.bugScenario")}</h2><p class="problem-copy">${escape(r.scenario.description)}</p><h3 class="subheading">${t("ui.symptomsScenarioAssumptions")}</h3>${list(r.scenario.symptoms)}<h3 class="subheading">${t("ui.expectedBehavior")}</h3><p class="problem-copy">${escape(r.scenario.expected)}</p>${r.scenario.cases.map((c) => `<div class="example-box pressed"><p>${escape(c.input)}</p><p>${t("training.expected", { value2: escape(c.expected) })}</p></div>`).join("")}<h3 class="subheading">${t("ui.versionsAndDependencies")}</h3>${list(r.scenario.requirements)}</article><article class="card flat"><div class="editor-heading"><h2>${t("ui.locateAndFix")}</h2><span class="tag">${escape(getConfig().languages[r.language])}</span></div><div id="training-code" class="monaco-host"></div>${field("cause", t("ui.myRootCauseAnalysis"), draft.cause, t("ui.identifyTheVariableExecutionOrderOrStateChange"), 4)}${field("checks", t("ui.howIWouldValidateIt"), draft.checks, t("ui.coverNormalAndFailurePathsPlusBoundariesOr"), 4)}<button class="button primary" data-ai id="diagnosis-review">${t("ui.submitDiagnosisAndFix")}</button><p class="evaluation-note">${t("ui.aIStaticReviewCodeAndTestsWereNot")}</p></article></div>`;
    if (r.kind === "debrief") {
      rows = Math.max(1, ...Object.keys(draft).filter((k) => k.startsWith("question:")).map((k) => Number(k.split(":")[1])));
      host.innerHTML = `<article class="card flat"><div class="training-form-grid">${["company", "role", "date", "stage"].map((k, i) => `<div class="field"><label for="debrief-${k}">${[t("ui.company"), t("ui.role"), t("ui.interviewDate"), t("ui.roundStage")][i]}</label><input id="debrief-${k}" data-training-field="${k}" ${k === "date" ? 'type="date"' : ""} maxlength="150" value="${escape(draft[k] ?? "")}"></div>`).join("")}</div>${field("notes", t("ui.overallFeedbackAndMyObservations"), draft.notes, t("ui.separateWhatTheInterviewerActuallySaidFromYour"), 4)}<p class="interview-help">${t("ui.recordEachQuestionLeaveForgottenPartsBlankInstead")}</p><div id="debrief-entries"></div><div class="training-actions"><button class="button flat" id="debrief-add">${t("ui.addAnotherQuestion")}</button><button class="button primary" data-ai id="debrief-review">${t("ui.submitDebriefAnalyzeFocus")}</button></div></article>`;
      renderEntries();
      $("#debrief-add").onclick = () => {
        if (rows >= 8) {
          toast(t("ui.upToQuestionsPerDebrief"));
          return;
        }
        rows++;
        draft[`question:${rows}`] = "";
        draft[`answer:${rows}`] = "";
        draft[`feedback:${rows}`] = "";
        remember();
        renderEntries();
      };
    }
    bindFields();
    $("#training-save").onclick = () => void flush().catch((e) => toast(e.message));
    if (r.kind === "compression") {
      $("#compression-analyze").onclick = () => void submit("analyze");
      $("#compression-rewrite").onclick = () => void submit("rewrite");
    }
    if (r.kind === "diagnosis") {
      mountEditor($("#training-code"), { id: r.id, filename: `diagnosis.${{ dart: "dart", kotlin: "kt", swift: "swift", python: "py", java: "java", go: "go", javascript: "js", typescript: "ts" }[r.language]}`, language: r.language, value: draft.code, onChange: () => change("code", editorValue()) });
      $("#diagnosis-review").onclick = () => void submit("review");
    }
    if (r.kind === "debrief") $("#debrief-review").onclick = () => void submit("review");
    renderFeedback(r);
    updateButtons();
    if (JSON.stringify(draft) !== JSON.stringify(r.draft)) void save(r.id, { ...draft }).catch(() => {
    });
  }
  function renderEntries() {
    const host = $("#debrief-entries");
    for (let n = 1; n <= rows; n++) {
      if ($(`#debrief-entry-${n}`)) continue;
      const el = document.createElement("section");
      el.id = `debrief-entry-${n}`;
      el.className = "debrief-entry";
      el.innerHTML = `<h3>${t("training.question2", { n: n })}</h3>${field(`question:${n}`, t("ui.actualInterviewQuestion"), draft[`question:${n}`] ?? "", t("ui.recordTheOriginalQuestionOrItsConfirmedMeaning"), 3)}<div class="training-form-grid">${field(`answer:${n}`, t("ui.myAnswerAtTheTime"), draft[`answer:${n}`] ?? "", t("ui.leaveBlankIfYouDonTRememberDon"), 5)}${field(`feedback:${n}`, t("ui.explicitInterviewerFeedbackOptional"), draft[`feedback:${n}`] ?? "", t("ui.onlyRecordFeedbackYouReceivedWithoutGuessingIntentions"), 5)}</div>`;
      host.append(el);
      bindFields(el);
    }
  }
  async function submit(action) {
    try {
      await flush();
      await startTask(`/api/trainings/${mountedId}/${action}`, { draft: { ...draft } }, "training");
    } catch (e) {
      toast(e.message);
    }
  }
  function renderTurns(r) {
    const host = $("#training-turns");
    r.turns.forEach((turn, i) => {
      let el = document.getElementById(`training-turn-${turn.id}`);
      if (!el) {
        el = document.createElement("article");
        el.id = `training-turn-${turn.id}`;
        el.className = "card flat";
        el.innerHTML = `<div class="section-heading"><span class="eyebrow">${t("training.attemptQuestions", { value1: i + 1 })}</span><span class="tag">${escape(turn.focus)}</span></div><h2 >${escape(turn.question)}</h2><details class="interview-reference pressed"><summary>${t("ui.referenceKeywordsAndEvidence")}</summary><div class="keyword-list" >${turn.keywords.map((k) => `<span>${escape(k)}</span>`).join("")}</div><p class="evidence-note">${escape(turn.evidenceNote)}</p>${list(turn.sourceIds.map((id) => r.sources.find((s) => s.id === id)?.title ?? id))}</details>${field(`answer:${turn.id}`, t("ui.myAnswer"), draft[`answer:${turn.id}`] ?? "", t("ui.conclusionFirstThenReasonsYourActionsAndVerifiable"), 6)}<div id="turn-feedback-${turn.id}"></div><button class="button primary" data-ai data-next-turn="${turn.id}">${t("ui.submitAnswerContinueFollowUp")}</button>`;
        host.append(el);
        bindFields(el);
        (/** @type {HTMLElement} */ (el.querySelector("[data-next-turn]"))).onclick = async () => {
          try {
            await flush();
            await startTask(`/api/trainings/${r.id}/next`, { turnId: turn.id, answer: draft[`answer:${turn.id}`] ?? "" }, "training");
          } catch (e) {
            toast(e.message);
          }
        };
      }
      const button = el.querySelector("[data-next-turn]");
      (/** @type {HTMLElement} */ (button)).hidden = !!turn.feedback || r.finished;
      const fb = el.querySelector(`[id="turn-feedback-${turn.id}"]`);
      if (turn.feedback) {
        const f = turn.feedback;
        fb.innerHTML = `<div class="answer-feedback"><p class="review-summary">${escape(f.summary)}</p>${dimensions({ technical: t("ui.contentAndMechanism"), evidence: t("ui.evidence"), expression: t("ui.focusedExpression") }, f)}${list(f.gaps)}<div class="keyword-list" >${f.keywords.map((k) => `<span>${escape(k)}</span>`).join("")}</div><details><summary>${t("ui.answerSnapshotUsedForThisFollowUp")}</summary><p class="problem-copy">${escape(turn.submittedAnswer)}</p></details>${(draft[`answer:${turn.id}`] ?? "") !== turn.submittedAnswer ? `<p class="stale-note">${t("ui.draftChangedFollowUpsStillUseTheSubmitted")}</p>` : ""}</div>`;
      }
    });
    $("#training-followup-end").innerHTML = r.finished ? `<article class="card flat"><h2>${t("ui.thisRoundIsComplete")}</h2><p class="problem-copy">${escape(r.stopReason)}</p><a class="button mint" href="#training/followup">${t("ui.startAnotherRound")}</a></article>` : "";
    updateButtons();
  }
  const dimensions = (labels, result) => `<dl class="interview-dimensions">${Object.entries(labels).map(([k, label]) => `<div><dt>${label}</dt><dd>${escape(result[k])}</dd></div>`).join("")}</dl>`;
  function updateStale() {
    const r = record(), review = r?.reviews.find((r2) => r2.id === reviewId) ?? r?.reviews.at(-1);
    const el = $("#training-stale");
    if (el && review) el.hidden = JSON.stringify(review.input) === JSON.stringify(draft);
  }
  function renderFeedback(r) {
    if (r.kind === "followup") {
      renderTurns(r);
      return;
    }
    const host = $("#training-feedback");
    if (!host) return;
    const review = r.reviews.find((x) => x.id === reviewId) ?? r.reviews.at(-1);
    if (!review) {
      host.innerHTML = "";
      return;
    }
    reviewId = review.id;
    const result = review.result;
    host.innerHTML = `<article class="card flat training-feedback-card"><div class="review-versions"><label for="training-review-version">${t("ui.submissions")}</label><select id="training-review-version">${r.reviews.slice().reverse().map((v, i) => `<option value="${v.id}" ${v.id === reviewId ? "selected" : ""}>${t("training.attempt", { value3: r.reviews.length - i, value4: v.action === "analyze" ? t("ui.originalAnswerAnalysis") : v.action === "rewrite" ? t("ui.condensedAnswerReview") : t("ui.submissionReview"), value5: date(v.at) })}</option>`).join("")}</select></div><p class="stale-note" id="training-stale" hidden>${t("ui.draftChangedResultsReflectTheSelectedSubmissionYou")}</p><p class="review-summary">${escape(result.summary)}</p><div id="training-result-body"></div><details class="training-snapshot"><summary>${t("training.submittedSnapshot", { value3: escape(review.model) })}</summary>${Object.entries(review.input).map(([k, v]) => `<p class="interview-help">${escape(fieldLabel(k))}</p><pre class="library-original-text">${escape(v)}</pre>`).join("")}</details></article>`;
    $("#training-review-version").onchange = (e) => {
      reviewId = e.target.value;
      renderFeedback(record());
    };
    const body = $("#training-result-body");
    if (r.kind === "compression") body.innerHTML = `${dimensions({ relevance: t("ui.relevance"), conciseness: t("ui.conciseness"), fidelity: t("ui.factsAndMeaningPreserved") }, result)}<h3 class="subheading">${t("ui.removeOrMoveThesePartsLater")}</h3>${result.cuts.length ? result.cuts.map((c) => `<blockquote class="training-cut">${escape(c.quote)}<p>${escape(c.reason)}</p></blockquote>`).join("") : `<p class="interview-help">${t("ui.noOriginalPassagesNeedRemoval")}</p>`}<h3 class="subheading">${t("ui.addOrPreserveThesePoints")}</h3>${list(result.missing)}<h3 class="subheading">${t("ui.refineFocusKeywords")}</h3><div class="keyword-list" >${result.keywords.map((k) => `<span>${escape(k)}</span>`).join("")}</div><h3 class="subheading">${t("ui.beforeAfterComparisonAndPracticeGoals")}</h3><p class="problem-copy">${escape(result.comparison)}</p>`;
    if (r.kind === "diagnosis") {
      body.innerHTML = `${dimensions({ cause: t("ui.rootCause"), repair: t("ui.doesTheFixAddressTheCause"), validation: t("ui.validationCoverage") }, result)}<h3 class="subheading">${t("ui.existingEvidence")}</h3>${list(result.strengths)}<h3 class="subheading">${t("ui.stillToCheck")}</h3>${list(result.gaps)}<h3 class="subheading">${t("ui.nextStep")}</h3>${list(result.nextSteps)}<p class="evaluation-note">${t("ui.staticReviewCodeWasNotRunValidateThe")}</p>`;
      renderReference(r);
    }
    if (r.kind === "debrief") {
      body.innerHTML = result.observations.map((o) => `<section class="debrief-observation"><h3>${t("training.question", { value1: escape(o.entryId), value2: escape(review.input[`question:${o.entryId}`]) })}</h3>${dimensions({ content: t("ui.contentAndMechanism"), expression: t("ui.focusedExpression"), evidence: t("ui.evidenceAndActualFeedback") }, o)}<p class="problem-copy">${t("training.suggestedPractice", { value4: escape(o.practice) })}</p><div class="keyword-list" >${o.keywords.map((k) => `<span>${escape(k)}</span>`).join("")}</div></section>`).join("") + `<h3 class="subheading">${t("ui.priorityImprovements")}</h3>${result.priorities.map((p, i) => `<div class="training-priority"><div><strong>${escape(p.title)}</strong><p>${escape(p.reason)}</p></div><button class="button mint" data-priority="${i}">${t("training.start", { value4: escape(getConfig().trainingKinds[p.kind]) })}</button></div>`).join("")}<h3 class="subheading">${t("ui.beforeYourNextInterview")}</h3>${list(result.nextSteps)}<p class="evaluation-note">${t("ui.feedbackUsesYourWrittenRecordItDoesNot")}</p>`;
      body.querySelectorAll("[data-priority]").forEach((b) => b.onclick = () => {
        const p = result.priorities[Number(b.dataset.priority)];
        if (p.kind === "diagnosis") {
          pendingFocus = `${t("training.questionPracticeNeeded", { value1: review.input[`question:${p.entryId}`] ?? "", reason: p.reason })}`.slice(0, 1e3);
          hubKind = "diagnosis";
          location.hash = "training/diagnosis";
        } else void begin({ kind: p.kind, debriefId: r.id, reviewId: review.id, entryId: p.entryId });
      });
    }
    updateStale();
  }
  function renderReference(r) {
    const host = $("#diagnosis-reference");
    if (!host) return;
    if (!r.revealedAt) {
      host.innerHTML = `<article class="card flat training-reference"><h2>${t("ui.referenceFix")}</h2><p class="interview-help">${t("ui.tryAgainUsingTheFeedbackViewTheFull")}</p><button id="diagnosis-reveal" class="button flat">${t("ui.viewReferenceFixAndExplanation")}</button></article>`;
      $("#diagnosis-reveal").onclick = async () => {
        try {
          const updated = await api(`/api/trainings/${r.id}/reveal`, "POST", {});
          const index = records().findIndex((t) => t.id === r.id);
          if (index >= 0) getState().trainings[index] = updated;
          if (mountedId === r.id) renderReference(updated);
        } catch (e) {
          toast(e.message);
        }
      };
      return;
    }
    if (host.dataset.revealed === r.id) return;
    referenceDispose?.();
    host.dataset.revealed = r.id;
    const ref = r.scenario.reference;
    host.innerHTML = `<article class="card flat training-reference"><h2>${t("ui.referenceFixAndExplanation")}</h2><p class="problem-copy">${escape(ref.cause)}</p><div id="diagnosis-reference-code" class="reference-host"></div><p class="problem-copy">${escape(ref.explanation)}</p><h3 class="subheading">${t("ui.validationChecks")}</h3>${list(ref.checks)}</article>`;
    referenceDispose = mountReference($("#diagnosis-reference-code"), { language: r.language, value: ref.fixedCode });
  }
  function completed() {
    reviewId = null;
    const r = record();
    if (r) {
      renderFeedback(r);
      updateButtons();
    }
  }
  return { renderHub, renderWorkspace, renderFeedback, completed, flush, remember, dispose, begin, hasWorkspace: () => !!mountedId };
}
export {
  createTrainingPractice
};
