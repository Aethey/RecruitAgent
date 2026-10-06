import { formatMessage } from './generated/localizations.ts';
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { load } from "cheerio";
import { AppError } from "./domain.ts";
import { jobInput, type InterviewJob, type JobSource } from "./interview.ts";

export type JobReader = (url: string) => Promise<{ title: string; content: string }>;
export function publicIPv4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export function jobUrl(value: string) {
  let url: URL; try { url = new URL(value); } catch { throw new AppError(400, formatMessage('zh', "ui.theLinkFormatIsInvalid")); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port)) ||
    url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") || !url.hostname.includes(".") ||
    (isIP(url.hostname) && !publicIPv4(url.hostname)) || url.hostname.includes(":")) throw new AppError(400, formatMessage('zh', "ui.theLinkMustBePublicDoNotUse"));
  url.hash = ""; return url;
}
export function extractJobHtml(html: string) {
  const $ = load(html), title = $("title").first().text().trim().slice(0, 150) || formatMessage('zh', "library.jobWebPage");
  const jobSchemas: string[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const walk = (v: unknown) => {
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (!v || typeof v !== "object") return;
        const o = v as Record<string, unknown>;
        if (o["@type"] === "JobPosting") jobSchemas.push([o.title, typeof o.hiringOrganization === "object" && o.hiringOrganization ? (o.hiringOrganization as Record<string, unknown>).name : "", o.description, JSON.stringify(o.qualifications ?? ""), JSON.stringify(o.skills ?? "")].join("\n"));
        if (o["@graph"]) walk(o["@graph"]);
      };
      walk(JSON.parse($(el).text()));
    } catch { /* Invalid structured data does not replace the visible page. */ }
  });
  $("script,style,noscript,nav,header,footer,[hidden],[aria-hidden='true']").remove();
  $("br").replaceWith("\n"); $("p,li,h1,h2,h3,h4,section,div,tr").append("\n");
  const main = $("main,article,[role='main']").first();
  let content = (main.length ? main.text() : $("body").text()).replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
  if (jobSchemas.length) content = `${jobSchemas.map(s => load(s).text()).join("\n")}\n${content}`;
  if (content.length < 120 || /^(?:access denied|just a moment|sign in|ログイン)/i.test(content)) throw new AppError(422, formatMessage('zh', "ui.theWebPageRequiresLoginOrHasNo2"));
  if (content.length > 60000) throw new AppError(422, formatMessage('zh', "ui.theWebPageContentIsTooLongPaste"));
  return { title, content };
}
export async function readPublicResource(value: string, maxBytes = 2000000, redirects = 0): Promise<{ data: Buffer; mime: string; url: string }> {
  const url = jobUrl(value);
  // Validate all DNS answers, then pin the socket address to avoid DNS rebinding.
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(a => !publicIPv4(a.address))) throw new AppError(400, formatMessage('zh', "ui.theLinkResolvesToANonPublicAddress"));
  const target = addresses[0].address;
  const page = await new Promise<{ redirect?: string; data?: Buffer; mime?: string }>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      family: 4,
      headers: { Accept: "text/html,application/xhtml+xml,text/plain,text/markdown,application/pdf,image/*", "Accept-Encoding": "identity", "User-Agent": "LocalStudyLibrary/1.0" },
      lookup: (_hostname, _options, callback) => callback(null, target, 4),
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) { response.resume(); resolve({ redirect: new URL(response.headers.location, url).href }); return; }
      if ((response.statusCode ?? 500) >= 400 || (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
        response.resume(); reject(new AppError(422, formatMessage('zh', "ui.theLinkCouldNotBeReadDownloadThe"))); return;
      }
      let length = 0; const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => { length += chunk.length; if (length > maxBytes) request.destroy(new AppError(422, formatMessage('zh', "ui.theWebPageOrFileIsTooLarge"))); else chunks.push(chunk); });
      response.on("end", () => resolve({ data: Buffer.concat(chunks), mime: (response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() })); response.on("error", reject);
    });
    const timer = setTimeout(() => request.destroy(new AppError(504, formatMessage('zh', "ui.readingTheLinkTimedOutPleaseDownloadThe"))), 15000);
    request.on("close", () => clearTimeout(timer)); request.on("error", reject); request.end();
  });
  if (page.redirect) { if (redirects >= 4) throw new AppError(422, formatMessage('zh', "ui.tooManyRedirectsPasteTheOriginalText")); return readPublicResource(page.redirect, maxBytes, redirects + 1); }
  return { data: page.data!, mime: page.mime!, url: url.href };
}
export async function readJobUrl(value: string): Promise<{ title: string; content: string }> {
  const page = await readPublicResource(value);
  if (!/text\/html|application\/xhtml\+xml|text\/plain/.test(page.mime)) throw new AppError(422, formatMessage('zh', "ui.theWebPageCannotBeReadOrIs"));
  return extractJobHtml(page.data.toString("utf8"));
}
export async function importJob(value: unknown, reader: JobReader = readJobUrl): Promise<InterviewJob> {
  const input = jobInput(value), sources: JobSource[] = [], warnings: string[] = [], at = new Date().toISOString();
  // Reject malformed/private URLs even if a pasted JD can otherwise serve as a fallback.
  input.urls.forEach(jobUrl);
  const results = await Promise.allSettled(input.urls.map(reader));
  results.forEach((result, i) => {
    if (result.status === "fulfilled") sources.push({ id: `job-url-${i + 1}`, kind: "job", title: result.value.title, content: result.value.content, url: input.urls[i], fetchedAt: at });
    else warnings.push(`${input.urls[i]}：${result.reason instanceof AppError ? result.reason.message : formatMessage('zh', "library.pasteWebText")}`);
  });
  if (input.description) sources.push({ id: "job-pasted", kind: "job", title: formatMessage('zh', "library.pastedJobText"), content: input.description, fetchedAt: at });
  if (!sources.length) throw new AppError(422, formatMessage('zh', "ui.noUsableJobDescriptionTextWasObtainedPaste"));
  if (sources.reduce((n, s) => n + s.content.length, 0) > 90000) throw new AppError(400, formatMessage('zh', "ui.thisSetOfJobMaterialsExceedsCharactersPlease"));
  return { id: randomUUID(), title: input.title, createdAt: at, sources, warnings };
}
