import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AppError, type State } from "./domain.ts";
import { stateValue } from './contract-validation.ts';

export class Store {
  private state: State = { version: 1, problems: [] };
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private path: string) {}
  async load() {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      const data = stateValue(JSON.parse(await readFile(this.path, "utf8")));
      if (data.version !== 1 || !Array.isArray(data.problems)) throw new Error("Unsupported data format");
      if (data.languageDrills !== undefined && !Array.isArray(data.languageDrills)) throw new Error("Invalid language practice data");
      if ((data.interviews !== undefined && !Array.isArray(data.interviews)) || (data.interviewJobs !== undefined && !Array.isArray(data.interviewJobs))) throw new Error("Invalid interview practice data");
      if(data.library !== undefined && !Array.isArray(data.library)) throw new Error("Invalid library data");
      if(data.trainings !== undefined && !Array.isArray(data.trainings)) throw new Error("Invalid training data");
      if(data.chats !== undefined && !Array.isArray(data.chats)) throw new Error("Invalid chat data");
      if (data.interviewMaterials !== undefined) {
        const ids: string[] = [];
        for (const role of ["resume", "personal", "study"] as const) {
          const values = data.interviewMaterials?.[role];
          if (!Array.isArray(values) || values.length > 20 || values.some(id => typeof id !== "string" || !data.library?.some(item => item.id === id))) throw new Error("Invalid interview material selection");
          ids.push(...values);
        }
        if (new Set(ids).size !== ids.length) throw new Error("Duplicate interview material selection");
      }
      for (const field of ["studyPoints", "studyCards", "studyBatches"] as const) if (data[field] !== undefined && !Array.isArray(data[field])) throw new Error("Invalid study data");
      if (data.settings?.visibleModels !== undefined && (!Array.isArray(data.settings.visibleModels) || data.settings.visibleModels.some(id => typeof id !== "string"))) throw new Error("Invalid model visibility settings");
      this.state = data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("做题记录无法读取，请检查 data/state.json；原文件未覆盖。", { cause: error });
    }
  }
  snapshot(): State { return structuredClone(this.state); }
  problem(id: string) {
    const p = this.state.problems.find(p => p.id === id);
    if (!p) throw new AppError(404, "题目不存在。");
    return structuredClone(p);
  }
  languageDrill(id: string) {
    const drill = this.state.languageDrills?.find(d => d.id === id);
    if (!drill) throw new AppError(404, "语言练习不存在。");
    return structuredClone(drill);
  }
  interview(id: string) {
    const set = this.state.interviews?.find(s => s.id === id);
    if (!set) throw new AppError(404, "面试练习不存在。");
    return structuredClone(set);
  }
  interviewJob(id: string) {
    const job = this.state.interviewJobs?.find(j => j.id === id);
    if (!job) throw new AppError(404, "职位资料不存在。");
    return structuredClone(job);
  }
  update<T>(change: (state: State) => T): Promise<T> {
    // All modules share the same serialized, atomic write queue.
    const next = this.pending.then(async () => {
      const state = this.snapshot();
      const result = change(state);
      stateValue(state);
      const temp = `${this.path}.tmp`;
      await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(temp, this.path);
      this.state = state;
      return structuredClone(result);
    });
    this.pending = next.catch(() => {});
    return next;
  }
  async flush() { await this.pending; }
  training(id:string){const record=this.state.trainings?.find(t=>t.id===id);if(!record)throw new AppError(404,"训练记录不存在。");return structuredClone(record);}
}
