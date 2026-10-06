import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError, object, type InterviewMaterials } from "./domain.ts";
import { Library } from "./library.ts";
import { Store } from "./store.ts";
import { DEFAULT_LOCALE } from "./locales.ts";
import { translateMessage } from "./ui-messages.ts";
import type { InterviewSelection, Source } from "./interview.ts";

export interface InterviewSources {
  status(): Promise<{ available: boolean; files: string[]; selection?: InterviewMaterials; legacy?: boolean }>;
  load(selection: InterviewSelection, jobText?: string): Promise<Source[]>;
}
const topicWords: Record<string, string[]> = {
  architecture: ["bloc", "state", "状態", "責務", "設計", "snapshot", "repository"], mobile: ["android", "flutter", "生命周期", "viewmodel", "compose", "activity"],
  language: ["kotlin", "dart", "swift", "coroutine", "flow", "非同期", "並行", "lambda"], sdk: ["sdk", "ble", "methodchannel", "pigeon", "native", "wear"],
  quality: ["テスト", "test", "性能", "安全", "セキュリティ", "crash", "ci/"], api: ["api", "network", "通信", "冪等", "idempot", "repository", "pending", "3ds"],
  ai: ["ai", "llm", "rag", "whisper", "embedding", "mcp", "mask"], delivery: ["重构", "リファクタリング", "migration", "移行", "判断", "what", "why", "タスク"],
};
export class FileInterviewSources implements InterviewSources {
  private cached?: { fingerprint: string; sources: Source[] };
  constructor(private directory: string) {}
  async status() {
    const names: string[] = await readdir(this.directory).catch(() => [] as string[]);
    const questions: string[] = await readdir(resolve(this.directory, "questions")).catch(() => [] as string[]);
    const files = [...names.filter(n => /\.(pdf|md|markdown)$/i.test(n)), ...questions.filter(n => /\.(md|markdown)$/i.test(n)).map(n => `questions/${n}`)];
    return { available: files.some(n => /\.pdf$/i.test(n) || /^(resume|cv|简历|履歴書|職務経歴書)/i.test(n)), files, legacy: true };
  }
  async load(selection: InterviewSelection, jobText = "") {
    const status = await this.status();
    if (!status.available) throw new AppError(400, "请在资料库上传简历，再到面试练习选择出题资料。");
    const files = await Promise.all(status.files.map(async name => ({ name, data: await readFile(resolve(this.directory, name)) })));
    const fingerprint = createHash("sha256").update(Buffer.concat(files.flatMap(f => [Buffer.from(f.name), f.data]))).digest("hex");
    if (this.cached?.fingerprint !== fingerprint) {
      const sources: Source[] = [];
      for (const { name, data } of files) {
        const key = createHash("sha256").update(name).digest("hex").slice(0, 12);
        if (/\.pdf$/i.test(name)) {
          const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
          const pdfRoot = resolve(dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json"))));
          const task = getDocument({ data: new Uint8Array(data), cMapUrl: `${pdfRoot}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${pdfRoot}/standard_fonts/`, verbosity: 0 });
          try {
            const pdf = await task.promise;
            for (let n = 1; n <= pdf.numPages; n++) {
              const page = await pdf.getPage(n), content = await page.getTextContent();
              let body = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
              if (name.startsWith("履歴書")) {
                // Personal/contact fields and the old company-specific motivation are not interview evidence.
                const start = body.indexOf("PR"); if (start < 0) continue;
                body = body.slice(start).split("志望動機")[0].trim();
              }
              if (body.length > 20) sources.push({ id: `resume-${key}-p${n}`, title: `${name} · ${n} 页`, kind: "resume", content: body });
            }
          } finally { await task.destroy(); }
        } else if (!name.startsWith("questions/")) {
          sources.push({ id: `document-${key}`, title: name, kind: /^(resume|cv|简历|履歴書|職務経歴書)/i.test(name) ? "resume" : "personal", content: data.toString("utf8") });
        } else {
          const md = data.toString("utf8"), sections = md.split(/(?=^#{2,3} )/m);
          sections.forEach((body, i) => {
            // JD/company sections are examples, not universal requirements or current job facts.
            if (body.length < 70 || (name.includes("楽天") && (i === 0 || /志望します|原文条件|职位要求|岗位定位|资格核对/.test(body.slice(0, 250))))) return;
            sources.push({ id: `study-${createHash("sha256").update(name).digest("hex").slice(0, 8)}-${i}`, title: `${name.split("/").at(-1)} · ${body.split("\n")[0].replace(/^#+\s*/, "")}`, kind: "study", content: body.slice(0, 2400) });
          });
        }
      }
      if (!sources.some(s => s.kind === "resume" && s.content.trim())) throw new AppError(400, "简历没有可读取的文字。扫描 PDF 请上传到资料库并整理后选择。 ");
      this.cached = { fingerprint, sources };
    }
    return selectSources(this.cached.sources, selection, jobText);
  }
}

export class LibraryInterviewSources implements InterviewSources {
  constructor(private store: Store, private library: Library, private legacy?: InterviewSources) {}
  async status() {
    const selection = this.store.snapshot().interviewMaterials;
    if (!selection && this.legacy) return this.legacy.status();
    const selected = selection ?? { resume: [], personal: [], study: [] };
    const items = Object.values(selected).flat().map(id => this.library.get(id));
    return { available: selected.resume.some(id => this.library.get(id).extractedText.trim().length > 0), files: items.map(i => i.title), selection: selected, legacy: false };
  }
  async save(value: unknown) {
    const input = object(value), selected: InterviewMaterials = { resume: [], personal: [], study: [] }, seen = new Set<string>();
    for (const role of ["resume", "personal", "study"] as const) {
      const ids = input[role];
      if (!Array.isArray(ids) || ids.length > 20) throw new AppError(400, "每类最多选择 20 份资料。");
      for (const id of ids) {
        if (typeof id !== "string" || seen.has(id)) throw new AppError(400, "同一份资料只选择一种用途。");
        this.library.get(id);
        seen.add(id); selected[role].push(id);
      }
    }
    await this.store.update(state => { state.interviewMaterials = selected; });
    return this.status();
  }
  async load(selection: InterviewSelection, jobText = "") {
    const state = this.store.snapshot(), materials = state.interviewMaterials;
    const locale = state.settings?.uiLanguage ?? DEFAULT_LOCALE;
    if (!materials && this.legacy) return this.legacy.load(selection, jobText);
    if (!(await this.status()).available) throw new AppError(400, "请在资料库上传可读取的简历，再到面试练习选择出题资料。扫描 PDF 或图片需先整理取得文字。");
    const sources: Source[] = [];
    for (const kind of ["resume", "personal", "study"] as const) {
      for (const id of materials?.[kind] ?? []) {
        const item = this.library.get(id);
        if (!item.extractedText.trim()) throw new AppError(400, translateMessage('interview.material.unreadable', locale, {title:item.title}));
        if (item.extractedText.length + item.notes.length > 60000) throw new AppError(400, translateMessage('interview.material.tooLong', locale, {title:item.title}));
        sources.push({ id: `library-${id}`, title: item.title, kind, content: item.extractedText + (item.notes ? `\n\n本人添加的备注：\n${item.notes}` : "") });
      }
    }
    if (sources.reduce((length, source) => length + source.content.length, 0) > 160000) throw new AppError(400, "面试资料合计过长，请减少所选资料。");
    return selectSources(sources, selection, jobText);
  }
}

function selectSources(sources: Source[], selection: InterviewSelection, jobText: string) {
    const candidate = sources.filter(s => s.kind !== "study");
    if (selection.type === "common") return candidate;
    const words = selection.topic === "all" || selection.type === "position" ? Object.values(topicWords).flat() : topicWords[selection.topic] ?? [];
    const jobWords = [...new Set(jobText.toLowerCase().match(/[a-z][a-z0-9+.#/-]{2,}/g) ?? [])].slice(0, 80);
    const scored = sources.filter(s => s.kind === "study").map((source, i) => ({ source, i, score: [...words, ...jobWords].reduce((sum, word) => sum + (source.content.toLowerCase().includes(word.toLowerCase()) ? 1 : 0), 0) }));
    // On mixed practice retain several fields before filling with the most relevant follow-ups.
    const selected: Source[] = [];
    if (selection.topic === "all" && selection.type === "technical") {
      for (const keywords of Object.values(topicWords)) {
        const match = scored.find(s => keywords.some(w => s.source.content.toLowerCase().includes(w.toLowerCase())) && !selected.includes(s.source));
        if (match) selected.push(match.source);
      }
    }
    for (const { source } of scored.sort((a, b) => b.score - a.score || a.i - b.i)) {
      if (selected.length >= 12) break;
      if (!selected.includes(source)) selected.push(source);
    }
    return [...candidate, ...selected];
}
