import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { load } from "cheerio";
import { AppError, object, text } from "./domain.ts";
import { jobUrl, readPublicResource } from "./job-import.ts";
import { Store } from "./store.ts";
import type { AIImage } from "./pi.ts";

export const LIBRARY_LIMIT = 20 * 1024 * 1024;
export type LibraryKind = "pdf" | "markdown" | "image" | "url";
export type LibraryPage = { number: number; text: string; vision: boolean; recognized?: boolean };
export type LibraryItem = { id: string; title: string; category: string; tags: string[]; summary: string; keyPoints: string[]; notes: string;
  kind: LibraryKind; filename: string; mime: string; blob: string; hash: string; size: number; origin: "existing" | "upload" | "url";
  sourcePath?: string; url?: string; createdAt: string; updatedAt: string; status: "pending" | "ready" | "error"; error?: string;
  extractedText: string; pages?: LibraryPage[]; organizedAt?: string; organizedModel?: string; visionModel?: string; revision: number };
export type PublicResourceReader = (url: string, maxBytes?: number) => Promise<{ data: Buffer; mime: string; url: string }>;
export function librarySummary(item: LibraryItem) {
  const { extractedText, pages, blob, hash, ...summary } = item;
  return { ...summary, pageCount: pages?.length ?? 0, visionPages: pages?.filter(p => p.vision).length ?? 0, textLength: extractedText.length };
}
function tags(value: unknown) {
  if (!Array.isArray(value) || value.length > 12) throw new AppError(400, "标签最多 12 个。");
  return [...new Set(value.map(v => text(v, 35).trim()))];
}
export function libraryMetadata(value: unknown) {
  const v = object(value);
  if (!Array.isArray(v.keyPoints) || v.keyPoints.length > 8) throw new AppError(400, "资料要点格式不正确。");
  return { title: text(v.title, 180).trim(), category: text(v.category, 40).trim(), tags: tags(v.tags), summary: text(v.summary, 1400).trim(), keyPoints: v.keyPoints.map(x => text(x, 350).trim()) };
}
export function libraryEdit(value: unknown) {
  const v = object(value);
  if (typeof v.notes !== "string" || v.notes.length > 20000) throw new AppError(400, "备注最多 20,000 字符。");
  return { title: text(v.title, 180).trim(), category: text(v.category, 40).trim(), tags: tags(v.tags), notes: v.notes };
}
export function fileType(filename: string, data: Buffer): { kind: LibraryKind; mime: string } {
  const ext = extname(filename).toLowerCase();
  if (ext === ".pdf" && data.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return { kind: "pdf", mime: "application/pdf" };
  if ([".md", ".markdown"].includes(ext) && !data.subarray(0, 1000).includes(Buffer.from([0])) ) return { kind: "markdown", mime: "text/markdown" };
  if (ext === ".png" && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { kind: "image", mime: "image/png" };
  if ([".jpg", ".jpeg"].includes(ext) && data[0] === 255 && data[1] === 216) return { kind: "image", mime: "image/jpeg" };
  if (ext === ".webp" && data.subarray(0,4).toString() === "RIFF" && data.subarray(8,12).toString() === "WEBP") return { kind: "image", mime: "image/webp" };
  if (ext === ".gif" && /^GIF8[79]a/.test(data.subarray(0,6).toString())) return { kind: "image", mime: "image/gif" };
  if (ext === ".avif" && data.subarray(4,8).toString() === "ftyp" && /avif|avis/.test(data.subarray(8,32).toString())) return { kind: "image", mime: "image/avif" };
  throw new AppError(400, "支持 PDF、MD、PNG、JPEG、WebP、GIF、AVIF；文件内容必须与扩展名一致。");
}
export function decodeMarkdown(data: Buffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { throw new AppError(400, "Markdown 请使用 UTF-8 编码保存后重新导入。"); }
}
export function extractPage(html: string) {
  const $ = load(html), title = $("title").first().text().trim().slice(0,180) || $("h1").first().text().trim().slice(0,180) || "网页资料";
  $("script,style,noscript,nav,header,footer,[hidden],[aria-hidden='true']").remove();
  $("br").replaceWith("\n"); $("p,li,h1,h2,h3,h4,section,div,tr,pre").append("\n");
  const main = $("main,article,[role='main']").first();
  const content = (main.length ? main.text() : $("body").text()).replace(/[ \t]+/g," ").replace(/\n\s*\n/g,"\n\n").trim();
  if (content.length < 40 || /^(access denied|just a moment|sign in|ログイン)/i.test(content)) throw new AppError(422, "网页需要登录或没有可读取正文，请导入保存的 PDF 或 Markdown。");
  return { title, content };
}
async function pdfTask(data: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const root = dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")));
  return getDocument({ data: new Uint8Array(data), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, wasmUrl: `${root}/wasm/`, verbosity: 0 });
}
function safeError(error: unknown) { return error instanceof AppError ? error.message : "资料读取失败。加密 PDF 请先解密；损坏文件请重新导出后导入。原文件已保留。"; }
export class Library {
  constructor(private store: Store, private directory: string, private reader: PublicResourceReader = readPublicResource) {}
  all() { return this.store.snapshot().library ?? []; }
  get(id: string) { const item = this.all().find(i => i.id === id); if (!item) throw new AppError(404, "资料不存在。"); return item; }
  async original(id: string) { const item = this.get(id); return { item, data: await readFile(resolve(this.directory, item.blob)) }; }
  async importFile(filename: string, data: Buffer, origin: LibraryItem["origin"] = "upload", sourcePath?: string) {
    if (!data.length || data.length > LIBRARY_LIMIT) throw new AppError(400, "单个文件必须介于 1 字节与 20 MB 之间。");
    filename = basename(filename.replaceAll("\\", "/")).slice(0,200);
    const type = fileType(filename, data), hash = createHash("sha256").update(data).digest("hex");
    const duplicate = this.all().find(i => i.hash === hash && i.kind === type.kind); if (duplicate) return { item: duplicate, duplicate: true };
    const at = new Date().toISOString(), id = randomUUID();
    const item: LibraryItem = { ...type, id, filename, title: filename.replace(/\.[^.]+$/, ""), category: origin === "existing" ? /履歴書|職務経歴/.test(filename) ? "简历" : "面试资料" : "待分类", tags: [], summary: "", keyPoints: [], notes: "", hash, blob: `${id}${extname(filename).toLowerCase()}`, size: data.length, origin, ...(sourcePath ? { sourcePath } : {}), createdAt: at, updatedAt: at, status: "pending", extractedText: "", revision: 0 };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(resolve(this.directory,item.blob), data, { mode: 0o600 });
    try {
      if (item.kind === "markdown") { item.extractedText = decodeMarkdown(data); item.title = item.extractedText.match(/^#\s+(.+)$/m)?.[1]?.slice(0,180) || item.title; }
      if (item.kind === "image") await this.image(id, data);
      if (item.kind === "pdf") {
        const task = await pdfTask(data);
        try {
          const pdf = await task.promise;
          if (pdf.numPages > 200) throw new AppError(400, "单个 PDF 最多 200 页，请分拆后导入。");
          item.pages = [];
          for (let number = 1; number <= pdf.numPages; number++) {
            const page = await pdf.getPage(number), content = await page.getTextContent();
            const body = content.items.map(i => "str" in i ? i.str + (i.hasEOL ? "\n" : " ") : "").join("").trim();
            // Image-bearing pages also need visual reading (e.g. charts embedded beside text).
            const operators = await page.getOperatorList();
            const { OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
            const images = operators.fnArray.some(n => [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(n));
            item.pages.push({ number, text: body, vision: body.replace(/\s/g,"").length < 30 || images }); page.cleanup();
          }
          item.extractedText = item.pages.map(p => `## 第 ${p.number} 页\n${p.text}`).join("\n\n");
        } finally { await task.destroy(); }
      }
      if (item.extractedText.length > 2000000) throw new AppError(400, "资料正文超过 2,000,000 字符，请分拆导入。");
    } catch (error) { item.status = "error"; item.error = safeError(error); }
    try { await this.store.update(s => { (s.library ??= []).push(item); }); }
    catch (error) { await rm(resolve(this.directory,item.blob),{force:true}); throw error; }
    return { item, duplicate: false };
  }
  async importURL(value: string) {
    const url = jobUrl(value).href, duplicate = this.all().find(i => i.url === url);
    if (duplicate) return { item: duplicate, duplicate: true };
    const response = await this.reader(url, LIBRARY_LIMIT), extension = extname(new URL(response.url).pathname).toLowerCase();
    if (response.mime === "application/pdf" || response.mime.startsWith("image/") || [".md", ".markdown"].includes(extension)) {
      const ext = response.mime === "application/pdf" ? ".pdf" : response.mime.startsWith("image/") ? ({"image/png":".png","image/jpeg":".jpg","image/webp":".webp","image/gif":".gif","image/avif":".avif"} as Record<string,string>)[response.mime] : extension;
      if (!ext) throw new AppError(400, "链接图片格式不受支持，请转为 PNG/JPEG 后上传。");
      const result = await this.importFile(`网页文件${ext}`,response.data,"url");
      if(result.duplicate)return result;
      await this.store.update(s => { const i = s.library!.find(i=>i.id===result.item.id)!; i.url=url; }); return { ...result, item: this.get(result.item.id) };
    }
    if (!["text/html","application/xhtml+xml","text/plain","text/markdown"].includes(response.mime)) throw new AppError(400,"链接不是可读取的网页、PDF、Markdown 或图片。");
    const page = /html/.test(response.mime) ? extractPage(response.data.toString("utf8")) : { title: "网页文本", content: decodeMarkdown(response.data).trim() };
    if (!page.content || page.content.length > 2000000) throw new AppError(400,"网页正文为空或过长。");
    const id=randomUUID(), at=new Date().toISOString(), blob=`${id}.txt`;
    const item: LibraryItem={id,title:page.title,category:"网页资料",tags:[],summary:"",keyPoints:[],notes:"",kind:"url",filename:page.title,mime:"text/plain",blob,hash:createHash("sha256").update(response.data).digest("hex"),size:response.data.length,origin:"url",url,createdAt:at,updatedAt:at,status:"pending",extractedText:page.content,revision:0};
    await mkdir(this.directory,{recursive:true,mode:0o700}); await writeFile(resolve(this.directory,blob),page.content,{mode:0o600});
    try { await this.store.update(s=>{(s.library??=[]).push(item);}); } catch(error){await rm(resolve(this.directory,blob),{force:true});throw error;}
    return {item,duplicate:false};
  }
  async importExisting(sourceDirectory: string) {
    const imported:string[]=[];
    const files: string[]=[];
    const walk=async(directory:string,prefix="")=>{for(const entry of await readdir(directory,{withFileTypes:true}).catch(()=>[])){const name=prefix+entry.name;if(entry.isDirectory())await walk(resolve(directory,entry.name),`${name}/`);else if(entry.isFile()&&/\.(pdf|md|markdown)$/i.test(name))files.push(name);}};
    await walk(sourceDirectory);
    for(const name of files){const data=await readFile(resolve(sourceDirectory,name)),hash=createHash("sha256").update(data).digest("hex");if(this.all().some(i=>i.origin==="existing"&&i.sourcePath===name&&i.hash===hash))continue;const result=await this.importFile(name,data,"existing",name);if(!result.duplicate)imported.push(result.item.id);}return imported;
  }
  async edit(id:string,value:unknown){const patch=libraryEdit(value);this.get(id);await this.store.update(s=>{const i=s.library!.find(i=>i.id===id)!;Object.assign(i,patch,{updatedAt:new Date().toISOString(),revision:i.revision+1});});return this.get(id);}
  async image(_id:string,data:Buffer):Promise<AIImage>{
    let image;try{image=await loadImage(data);}catch{throw new AppError(400,"图片无法解码，请重新导出为 PNG/JPEG。");}
    if(image.width*image.height>50000000)throw new AppError(400,"图片超过 5,000 万像素，请先缩小。");
    const ratio=Math.min(1,2000/Math.max(image.width,image.height)),canvas=createCanvas(Math.max(1,Math.round(image.width*ratio)),Math.max(1,Math.round(image.height*ratio)));
    const context=canvas.getContext("2d");context.fillStyle="#ffffff";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    return {type:"image",mimeType:"image/png",data:canvas.toBuffer("image/png").toString("base64")};
  }
  async pdfImages(id:string,numbers:number[],signal:AbortSignal):Promise<AIImage[]>{
    const {data}=await this.original(id), task=await pdfTask(data);const images:AIImage[]=[];
    try{const pdf=await task.promise;for(const n of numbers){signal.throwIfAborted();const page=await pdf.getPage(n);const viewport=page.getViewport({scale:1});const scale=Math.min(2,2000/Math.max(viewport.width,viewport.height));const view=page.getViewport({scale});const canvas=createCanvas(Math.ceil(view.width),Math.ceil(view.height));await page.render({canvas:canvas as unknown as HTMLCanvasElement,canvasContext:canvas.getContext("2d") as unknown as CanvasRenderingContext2D,viewport:view}).promise;images.push({type:"image",mimeType:"image/png",data:canvas.toBuffer("image/png").toString("base64")});page.cleanup();}}finally{await task.destroy();}return images;
  }
}
