import { element, elements } from './dom.ts';
import { t, ui } from "./i18n.js";
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
      if (id === mountedId && JSON.stringify(snapshot) === JSON.stringify(draft)) badge(t("已保存到本机 ✓"));
    });
    queue = op;
    try {
      await op;
    } catch (e) {
      if (id === mountedId) badge(t("保存失败 · 点击重试"), true);
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
    badge(t("正在保存…"));
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
    const labels = { original: t("原回答"), points: t("压缩后的要点"), code: t("修复代码"), cause: t("根因判断"), checks: t("验证思路"), company: t("公司"), role: t("职位"), date: t("面试日期"), stage: t("轮次"), notes: t("整体反馈与观察") };
    if (labels[name]) return labels[name];
    const [kind, id] = name.split(":");
    const entryLabels = { question: t("实际问题"), answer: t("我的回答"), feedback: t("面试官明确反馈") };
    return entryLabels[kind] ? ui`问题 ${id} · ${entryLabels[kind]}` : name;
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
    $("#page").innerHTML = pageHeading("PRACTICE WITH PURPOSE", t("把练习，变成下一次的进步。"), t("练重点、追理由、查故障，再用真实面试反馈调整练习。")) + ui`<div class="training-modes" role="group" aria-label="能力训练类型">${Object.entries(config.trainingKinds).map(([k, v]) => `<button class="button ${k === hubKind ? "pressed selected" : "flat"}" data-training-kind="${k}" aria-pressed="${k === hubKind}">${escape(v)}</button>`).join("")}</div><section class="card flat training-generator" id="training-generator"></section><section class="language-history training-history"><div class="section-heading"><h2>训练记录</h2><span class="tag">${records().filter((r) => r.kind === hubKind).length} 份</span></div>${records().filter((r) => r.kind === hubKind).slice().reverse().map((r) => `<a class="history-item flat" href="#training/${r.id}"><div><h3 class="history-title">${escape(r.title)}</h3><div class="history-meta">${date(r.updatedAt)} · ${r.kind === "followup" ? ui`${r.turns.length} 道递进问题` : ui`${r.reviews.length} 次提交`}</div></div><span>↗</span></a>`).join("") || t('<div class="card flat empty-small">还没有这类训练，开始一轮即可保存记录。</div>')}</section>`;
    elements("[data-training-kind]").forEach((b) => b.onclick = () => {
      hubKind = b.dataset.trainingKind;
      const nextHash = `#training/${hubKind}`;
      if (location.hash === nextHash) renderHub(hubKind);
      else location.hash = nextHash;
    });
    const host = $("#training-generator");
    if (hubKind === "diagnosis") {
      host.innerHTML = ui`<h2>诊断一个工程故障</h2><p class="interview-help">读现象、定位根因、修改代码，并说明怎样验证。参考修复在提交后按需查看。</p><form id="diagnosis-form" class="generator-form"><div class="training-form-grid"><div class="field"><label for="diagnosis-language">语言</label><select id="diagnosis-language">${options(config.languages, "dart")}</select></div><div class="field"><label for="diagnosis-topic">故障方向</label><select id="diagnosis-topic">${options(config.diagnosisTopics, "state")}</select></div></div>${field("focus", t("希望补强的场景 · 可选"), pendingFocus, t("例如：多个异步请求完成顺序不同，旧结果覆盖新状态。"), 3)}<button class="button primary" data-ai type="submit">生成故障练习 →</button><p class="form-note">AI 教学情境与静态评估，不在后端执行代码。</p></form>`;
      $("#diagnosis-form").onsubmit = (e) => {
        e.preventDefault();
        void startTask("/api/trainings/diagnosis", { language: $("#diagnosis-language").value, topic: $("#diagnosis-topic").value, focus: $("#training-focus").value }, "training");
      };
    } else if (hubKind === "debrief") {
      host.innerHTML = t('<h2>记录刚结束的一次面试</h2><p class="problem-copy">按题记录实际问题、自己的回答和收到的反馈。模型观察与面试官反馈分开显示；复盘后直接进入压缩或追问练习。</p><button class="button mint" id="new-debrief">新建面试复盘 ＋</button><p class="form-note">新建和保存不调用 AI，点击分析时才使用 Codex。</p>');
      $("#new-debrief").onclick = () => void begin({ kind: "debrief" });
    } else {
      const sets = getState().interviews ?? [], qs = sets.flatMap((s) => s.questions.map((q) => ({ value: `${s.id}/${q.id}`, label: `${s.title} · ${q.question}` })));
      host.innerHTML = ui`<h2>${hubKind === "compression" ? t("把回答压缩到重点") : t("从一个回答继续深入")}</h2><p class="interview-help">${hubKind === "compression" ? t("先诊断原回答，再自己改成3–5条短要点，提交后比较改善与遗漏。") : t("每次回答后只追问一个关键问题，最多八题；不做聊天，保留逐题依据与评价。")}</p><form id="start-training-form" class="generator-form"><div class="field"><label for="training-source-question">选择已有面试题</label><select id="training-source-question">${options(Object.fromEntries(qs.map((q) => [q.value, q.label])), "", t("手动输入一个问题"))}</select></div><div id="manual-training">${field("question", t("面试问题"), "", t("例如：なぜこの設計を選びましたか？"), 2)}${field("original", t("自己的原回答 · 追问可稍后填写"), "", t("保留你实际会说的内容，不要先让模型代写。"), 6)}</div><button type="submit" class="button primary">开始这轮训练 →</button><p class="form-note">创建与保存不调用模型；已有题会带入当前回答和参考来源。</p></form>`;
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
    $("#page").innerHTML = pageHeading("FOCUSED PRACTICE", escape(r.title), getConfig().trainingKinds[r.kind], t('<a class="button flat" href="#training">返回能力训练</a>')) + ui`<div class="interview-actions"><button id="training-save" class="save-state">已保存到本机 ✓</button><span class="interview-help">每次提交保留快照，评价期间可以继续编辑。</span></div><section id="training-workspace"></section><section id="training-feedback"></section>${r.kind === "diagnosis" ? '<section id="diagnosis-reference"></section>' : ""}`;
    const host = $("#training-workspace");
    if (r.kind === "compression") host.innerHTML = ui`<article class="card flat"><h2>原回答与压缩稿</h2><div class="training-form-grid">${field("original", t("① 原回答"), draft.original, t("保留完整原回答。"), 10)}${field("points", t("② 自己压缩后的要点"), draft.points, t("一行一个，3–5行；每行不超过80字符。\n結論：…\n行動：…\n結果：…"), 10)}</div><div class="training-actions"><button class="button flat" data-ai id="compression-analyze">分析原回答</button><button class="button primary" data-ai id="compression-rewrite">评价我的压缩稿 →</button></div><p class="interview-help">保留事实与关键因果，删掉重复和不必要的铺垫。系统不会用长答案替代你的练习。</p></article>`;
    if (r.kind === "followup") host.innerHTML = '<div id="training-turns" class="training-turns"></div><div id="training-followup-end"></div>';
    if (r.kind === "diagnosis") host.innerHTML = ui`<div class="training-diagnosis-grid"><article class="card flat"><h2>故障情境</h2><p class="problem-copy">${escape(r.scenario.description)}</p><h3 class="subheading">现象 · 题目设定</h3>${list(r.scenario.symptoms)}<h3 class="subheading">应有行为</h3><p class="problem-copy">${escape(r.scenario.expected)}</p>${r.scenario.cases.map((c) => ui`<div class="example-box pressed"><p>${escape(c.input)}</p><p>预期：${escape(c.expected)}</p></div>`).join("")}<h3 class="subheading">版本与依赖</h3>${list(r.scenario.requirements)}</article><article class="card flat"><div class="editor-heading"><h2>定位并修复</h2><span class="tag">${escape(getConfig().languages[r.language])}</span></div><div id="training-code" class="monaco-host"></div>${field("cause", t("我判断的根因"), draft.cause, t("指出具体变量、执行顺序或状态变化。"), 4)}${field("checks", t("我会如何验证"), draft.checks, t("正常路径、失败路径，以及能暴露原故障的边界或并发场景。"), 4)}<button class="button primary" data-ai id="diagnosis-review">提交诊断与修复 →</button><p class="evaluation-note">AI 静态审查，未执行代码或测试。</p></article></div>`;
    if (r.kind === "debrief") {
      rows = Math.max(1, ...Object.keys(draft).filter((k) => k.startsWith("question:")).map((k) => Number(k.split(":")[1])));
      host.innerHTML = ui`<article class="card flat"><div class="training-form-grid">${["company", "role", "date", "stage"].map((k, i) => `<div class="field"><label for="debrief-${k}">${[t("公司"), t("职位"), t("面试日期"), t("轮次 / 阶段")][i]}</label><input id="debrief-${k}" data-training-field="${k}" ${k === "date" ? 'type="date"' : ""} maxlength="150" value="${escape(draft[k] ?? "")}"></div>`).join("")}</div>${field("notes", t("整体反馈与自己的观察"), draft.notes, t("请区分面试官明确说的话，以及你自己的推测。"), 4)}<p class="interview-help">逐题记录；没记住的部分可留空，不需要补造当时的回答。</p><div id="debrief-entries"></div><div class="training-actions"><button class="button flat" id="debrief-add">再记录一道题 ＋</button><button class="button primary" data-ai id="debrief-review">提交复盘 · 分析重点 →</button></div></article>`;
      renderEntries();
      $("#debrief-add").onclick = () => {
        if (rows >= 8) {
          toast(t("每次复盘最多8道题。"));
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
      el.innerHTML = ui`<h3>问题 ${n}</h3>${field(`question:${n}`, t("实际面试问题"), draft[`question:${n}`] ?? "", t("记下原问题或你能确认的意思。"), 3)}<div class="training-form-grid">${field(`answer:${n}`, t("我当时的回答"), draft[`answer:${n}`] ?? "", t("不记得可以留空；不要事后代写成当时说过的话。"), 5)}${field(`feedback:${n}`, t("面试官明确给出的反馈 · 可空"), draft[`feedback:${n}`] ?? "", t("只记录收到的反馈，不猜测面试官想法。"), 5)}</div>`;
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
        el.innerHTML = ui`<div class="section-heading"><span class="eyebrow">第 ${i + 1} / 8 题</span><span class="tag">${escape(turn.focus)}</span></div><h2 >${escape(turn.question)}</h2><details class="interview-reference pressed"><summary>参考关键词与依据</summary><div class="keyword-list" >${turn.keywords.map((k) => `<span>${escape(k)}</span>`).join("")}</div><p class="evidence-note">${escape(turn.evidenceNote)}</p>${list(turn.sourceIds.map((id) => r.sources.find((s) => s.id === id)?.title ?? id))}</details>${field(`answer:${turn.id}`, t("我的回答"), draft[`answer:${turn.id}`] ?? "", t("先结论，再给理由、本人行动与可验证结果。"), 6)}<div id="turn-feedback-${turn.id}"></div><button class="button primary" data-ai data-next-turn="${turn.id}">提交回答 · 继续追问 →</button>`;
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
        fb.innerHTML = ui`<div class="answer-feedback"><p class="review-summary">${escape(f.summary)}</p>${dimensions({ technical: t("内容与机制"), evidence: t("事实依据"), expression: t("重点表达") }, f)}${list(f.gaps)}<div class="keyword-list" >${f.keywords.map((k) => `<span>${escape(k)}</span>`).join("")}</div><details><summary>本次追问依据的回答快照</summary><p class="problem-copy">${escape(turn.submittedAnswer)}</p></details>${(draft[`answer:${turn.id}`] ?? "") !== turn.submittedAnswer ? t('<p class="stale-note">草稿已修改，后续追问仍基于这次提交的快照。</p>') : ""}</div>`;
      }
    });
    $("#training-followup-end").innerHTML = r.finished ? ui`<article class="card flat"><h2>这一轮已完成</h2><p class="problem-copy">${escape(r.stopReason)}</p><a class="button mint" href="#training/followup">再开始一轮 →</a></article>` : "";
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
    host.innerHTML = ui`<article class="card flat training-feedback-card"><div class="review-versions"><label for="training-review-version">提交记录</label><select id="training-review-version">${r.reviews.slice().reverse().map((v, i) => ui`<option value="${v.id}" ${v.id === reviewId ? "selected" : ""}>第 ${r.reviews.length - i} 次 · ${v.action === "analyze" ? t("原回答分析") : v.action === "rewrite" ? t("压缩稿评价") : t("提交评价")} · ${date(v.at)}</option>`).join("")}</select></div><p class="stale-note" id="training-stale" hidden>草稿已修改。以下结果对应所选提交，保留的新内容可再次提交。</p><p class="review-summary">${escape(result.summary)}</p><div id="training-result-body"></div><details class="training-snapshot"><summary>本次提交快照 · ${escape(review.model)}</summary>${Object.entries(review.input).map(([k, v]) => `<p class="interview-help">${escape(fieldLabel(k))}</p><pre class="library-original-text">${escape(v)}</pre>`).join("")}</details></article>`;
    $("#training-review-version").onchange = (e) => {
      reviewId = e.target.value;
      renderFeedback(record());
    };
    const body = $("#training-result-body");
    if (r.kind === "compression") body.innerHTML = ui`${dimensions({ relevance: t("切题"), conciseness: t("简洁"), fidelity: t("事实与含义保留") }, result)}<h3 class="subheading">这些内容可以删 / 后移</h3>${result.cuts.length ? result.cuts.map((c) => `<blockquote class="training-cut">${escape(c.quote)}<p>${escape(c.reason)}</p></blockquote>`).join("") : t('<p class="interview-help">没有需要删除的原文片段。</p>')}<h3 class="subheading">需要补充或保留</h3>${list(result.missing)}<h3 class="subheading">提炼重点 · 关键词</h3><div class="keyword-list" >${result.keywords.map((k) => `<span>${escape(k)}</span>`).join("")}</div><h3 class="subheading">压缩前后对照 / 练习目标</h3><p class="problem-copy">${escape(result.comparison)}</p>`;
    if (r.kind === "diagnosis") {
      body.innerHTML = ui`${dimensions({ cause: t("根因判断"), repair: t("修复是否对症"), validation: t("验证覆盖") }, result)}<h3 class="subheading">已有依据</h3>${list(result.strengths)}<h3 class="subheading">还需检查</h3>${list(result.gaps)}<h3 class="subheading">下一步</h3>${list(result.nextSteps)}<p class="evaluation-note">静态审查，未运行代码。参考修复也需要结合实际环境验证。</p>`;
      renderReference(r);
    }
    if (r.kind === "debrief") {
      body.innerHTML = result.observations.map((o) => ui`<section class="debrief-observation"><h3>问题 ${escape(o.entryId)} · ${escape(review.input[`question:${o.entryId}`])}</h3>${dimensions({ content: t("内容与机制"), expression: t("重点表达"), evidence: t("依据与实际反馈") }, o)}<p class="problem-copy">建议练习：${escape(o.practice)}</p><div class="keyword-list" >${o.keywords.map((k) => `<span>${escape(k)}</span>`).join("")}</div></section>`).join("") + ui`<h3 class="subheading">优先补强</h3>${result.priorities.map((p, i) => ui`<div class="training-priority"><div><strong>${escape(p.title)}</strong><p>${escape(p.reason)}</p></div><button class="button mint" data-priority="${i}">开始${escape(getConfig().trainingKinds[p.kind])} →</button></div>`).join("")}<h3 class="subheading">下一次面试前</h3>${list(result.nextSteps)}<p class="evaluation-note">评价依据你记录的书面内容；不推断录用结果、口语水平或未提供的面试官想法。</p>`;
      body.querySelectorAll("[data-priority]").forEach((b) => b.onclick = () => {
        const p = result.priorities[Number(b.dataset.priority)];
        if (p.kind === "diagnosis") {
          pendingFocus = ui`问题：${review.input[`question:${p.entryId}`] ?? ""}
需练习：${p.reason}`.slice(0, 1e3);
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
      host.innerHTML = t('<article class="card flat training-reference"><h2>参考修复</h2><p class="interview-help">先根据评价再次尝试；需要对照时，再查看完整修复与解释。查看不调用模型。</p><button id="diagnosis-reveal" class="button flat">查看参考修复与讲解</button></article>');
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
    host.innerHTML = ui`<article class="card flat training-reference"><h2>参考修复与讲解</h2><p class="problem-copy">${escape(ref.cause)}</p><div id="diagnosis-reference-code" class="reference-host"></div><p class="problem-copy">${escape(ref.explanation)}</p><h3 class="subheading">验证检查</h3>${list(ref.checks)}</article>`;
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
