import { taskDefinition } from './task-policy.ts';
import { TrainingService } from '../features/training/service.ts';
import { systemPrompt } from './model-prompts.ts';
import { AlgorithmTasks } from '../features/algorithm/tasks.ts';
import { ChatTasks } from '../features/chat/tasks.ts';
import { LanguageTasks } from '../features/language/tasks.ts';
import { InterviewTasks } from '../features/interview/tasks.ts';
import { LibraryTasks } from '../features/library/tasks.ts';
import { TrainingTasks } from '../features/training/tasks.ts';
import { StudyTasks } from '../features/study/tasks.ts';
import { formatMessage } from '../generated/localizations.ts';
import { translateSource } from "../shared/i18n/messages.ts";
import { DEFAULT_LOCALE, LOCALE_TAGS, isLocale } from "../shared/i18n/locales.ts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { root } from "../../scripts/runtime.mjs";
import { exportBackup } from "../shared/persistence/backup.ts";
import { apiContract, validateApiValue } from '../contracts/validation.ts';
import { Auth } from "../integrations/pi/auth.ts";
import { AppError } from '../shared/errors.ts';
import { codeInput, DIFFICULTIES, evidenceBasis, REVIEW_LABEL, selection, statistics, TOPICS } from '../features/algorithm/domain.ts';
import { DEFAULT_TEACHER_SETTINGS, teacherSettings } from '../features/chat/settings.ts';
import { LANGUAGES } from '../shared/programming.ts';
import { object, text } from '../shared/input.ts';
import { PiAI } from '../integrations/pi/client.ts';
import type { AI } from '../shared/ai/types.ts';
import { Store } from "../shared/persistence/store.ts";
import { Tasks } from "../shared/tasks/executor.ts";
import { Chat } from "../features/chat/service.ts";
import { CodexVoice, type VoiceRpc } from "../integrations/codex/voice.ts";
import { Diagnostics, loggedAI } from '../shared/diagnostics.ts';
import { randomUUID } from 'node:crypto';
import type { VoiceDiagnosticInput } from '../contracts/api.ts';
import { VoiceInterviews } from "../features/interview/voice.ts";
import { LANGUAGE_SYLLABUS, languageSelection } from "../features/language/domain.ts";
import { INTERVIEW_TYPES, INTERVIEW_TOPICS, interviewSelection, interviewAnswers, publicInterview } from "../features/interview/domain.ts";
import { FileInterviewSources, LibraryInterviewSources, type InterviewSources } from "../features/interview/sources.ts";
import { importJob, type JobReader } from "../features/interview/job-import.ts";
import { Library, LIBRARY_LIMIT, librarySummary, type PublicResourceReader } from "../features/library/service.ts";

import { TRAINING_KINDS, DIAGNOSIS_TOPICS, diagnosisSelection, publicTraining } from "../features/training/domain.ts";

import { Study, STUDY_CATEGORIES, STUDY_FACETS, studySelection, publicBatch } from "../features/study/service.ts";


function json(response: ServerResponse, status: number, body: unknown) {
  if (status >= 200 && status < 300) {
    const contract = apiContract(response.req.method ?? 'GET', new URL(response.req.url ?? '/', 'http://localhost').pathname);
    if (!contract || !validateApiValue(contract.response, body)) throw new AppError(500, formatMessage('zh', "ui.theDataFormatReturnedByTheAPIIs"));
  }
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}
async function body(request: IncomingMessage) {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new AppError(415, formatMessage('zh', "ui.requestsMustUseJSON"));
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 400000) throw new AppError(413, formatMessage('zh', "ui.requestContentIsTooLarge"));
    chunks.push(chunk);
  }
  let input: unknown;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppError(400, formatMessage('zh', "ui.invalidJSONFormat")); }
  const contract = apiContract(request.method ?? 'GET', new URL(request.url ?? '/', 'http://localhost').pathname);
  if (contract?.request && !validateApiValue(contract.request, input)) throw new AppError(400, formatMessage('zh', "ui.theRequestDataStructureIsInvalid"));
  return input;
}
export async function createApp(options: { dataDir?: string; ai?: AI; interviewSources?: InterviewSources; jobReader?: JobReader; sourceDir?: string | null; libraryReader?: PublicResourceReader; studyClock?: () => Date; voiceRpcFactory?: () => Promise<VoiceRpc> } = {}) {
  const dataDir = resolve(root, options.dataDir ?? process.env.DATA_DIR ?? "data");
  const diagnostics = new Diagnostics(dataDir);
  diagnostics.record('server','created');
  const store = new Store(resolve(dataDir, "state.json"));
  await store.load();
  const chats = new Chat(store);
  const voice = new CodexVoice(dataDir, options.voiceRpcFactory,40000,diagnostics);
  await chats.recover();
  const library=new Library(store,resolve(dataDir,"library"),options.libraryReader);
  const sourceDir = options.sourceDir === null ? null : resolve(root, options.sourceDir ?? process.env.SOURCE_DIR ?? "sources");
  if(sourceDir)await library.importExisting(sourceDir);
  const ai = loggedAI(options.ai ?? await PiAI.create(dataDir,systemPrompt,diagnostics),diagnostics);
  const voiceInterviews = new VoiceInterviews(store,voice,ai);
  await voiceInterviews.recover();
  const savedModel = store.snapshot().settings?.model;
  if (savedModel && ai.models().some(model => model.id === savedModel)) ai.setModel(savedModel);
  const materialSources = new LibraryInterviewSources(store, library, sourceDir ? new FileInterviewSources(sourceDir) : undefined);
  const interviewSources = options.interviewSources ?? materialSources;
  const study = new Study(store, options.studyClock);
  const auth = new Auth(ai), tasks = new Tasks(ai, store,taskDefinition);
  const algorithmTasks = new AlgorithmTasks(tasks,store);
  const chatTasks = new ChatTasks(tasks,ai);
  const languageTasks = new LanguageTasks(tasks,store);
  const interviewTasks = new InterviewTasks(tasks,store,interviewSources);
  const libraryTasks = new LibraryTasks(tasks,ai,store,library);
  const trainings = new TrainingService(store);
  const trainingTasks = new TrainingTasks(tasks,ai,store);
  const studyTasks = new StudyTasks(tasks,ai,store,study);
  let modelChanging = false;
  function ensureModelReady() { if (modelChanging) throw new AppError(409, formatMessage('zh', "ui.theModelIsSwitchingPleaseTryAgainLater")); }
  async function modelSettings() {
    const { model } = await ai.status();
    const settings = store.snapshot().settings, saved = settings?.visibleModels;
    return { model, visibleModels: ai.models().filter(option => !saved || saved.includes(option.id) || option.id === model).map(option => option.id), teacher: settings?.teacher ?? DEFAULT_TEACHER_SETTINGS, uiLanguage: settings?.uiLanguage ?? DEFAULT_LOCALE, userLanguage: settings?.userLanguage ?? DEFAULT_LOCALE };
  }
  const server = createServer((request, response) => {
    const requestId = randomUUID(); response.setHeader('X-Request-ID',requestId);
    diagnostics.run(requestId,() => { void route(request,response); });
  });
  async function route(request: IncomingMessage, response: ServerResponse) {
    try {
      const host = request.headers.host ?? "";
      if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new AppError(403, formatMessage('zh', "ui.localAccessOnly"));
      const origin = request.headers.origin;
      if (origin && origin !== `http://${host}`) throw new AppError(403, formatMessage('zh', "ui.crossSiteRequestsAreNotAllowed"));
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      // Monaco needs runtime styles; PDF image decoders need WASM compilation, without JavaScript eval.
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      const url = new URL(request.url ?? "/", `http://${host}`), path = url.pathname, method = request.method;
      const after = Number(request.headers["last-event-id"] ?? "0") || 0;
      if (method === "GET" && path === "/api/health") { json(response, 200, { ok: true, app: "RecruitAgent" }); return; }
      if (method === "GET" && path === "/api/backup") {
        const data = await exportBackup(store, dataDir);
        response.writeHead(200, { "Content-Type": "application/gzip", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="recruitagent-${new Date().toISOString().slice(0, 10)}.json.gz"` });
        response.end(data); return;
      }
      if (method === "GET" && path === "/api/interview-sources") { json(response, 200, await interviewSources.status()); return; }
      if (method === "PUT" && path === "/api/interview-sources") { json(response, 200, await materialSources.save(await body(request))); return; }
      if (method === "GET" && path === "/api/voice/status") { json(response,200,await voice.status()); return; }
      if (method === "GET" && path === "/api/voice/options") { json(response,200,await voice.options()); return; }
      if (method === "POST" && path === "/api/voice/sessions") {
        const input = object(await body(request)), language = store.snapshot().settings?.userLanguage ?? DEFAULT_LOCALE;
        if (input.preview && input.interviewId) throw new AppError(400,formatMessage('zh', "ui.voicePreviewIsNotPartOfTheInterview"));
        json(response,201,input.preview === true ? await voice.startPreview(input,language) : input.interviewId ? await voiceInterviews.start(input,language) : await voice.start(input,language)); return;
      }
      const voiceAction = path.match(/^\/api\/voice\/sessions\/([\w-]+)\/(action|verify|preview|control|diagnostics)$/);
      if (method === "POST" && voiceAction) { const input = await body(request); json(response,200,voiceAction[2] === "diagnostics" ? voice.diagnostic(voiceAction[1],input as VoiceDiagnosticInput) : voiceAction[2] === "control" ? await voice.control(voiceAction[1],input) : voiceAction[2] === "action" ? await voiceInterviews.action(voiceAction[1],input) : voiceAction[2] === "preview" ? await voice.preview(voiceAction[1]) : await voice.verifyAudio(voiceAction[1],input)); return; }
      const voiceSession = path.match(/^\/api\/voice\/sessions\/([\w-]+)(\/events)?$/);
      if (method === "GET" && voiceSession?.[2]) { voice.connect(voiceSession[1],response,after); return; }
      if (method === "DELETE" && voiceSession && !voiceSession[2]) { await voice.end(voiceSession[1]); json(response,200,{ended:true}); return; }
      if (method === "GET" && path === "/api/state") {
        const { chats: _chats, ...state } = store.snapshot();
        json(response, 200, { ...state, studyBatches: (state.studyBatches ?? []).map(publicBatch), study: study.overview(), trainings: (state.trainings??[]).map(publicTraining), library: (state.library??[]).map(librarySummary), languageDrills: state.languageDrills ?? [], interviews: (state.interviews ?? []).map(publicInterview), interviewJobs: state.interviewJobs ?? [], stats: statistics(state.problems), analysisStale: state.analysis ? state.analysis.basis !== evidenceBasis(state.problems) : false, activeJob: tasks.activeJob(), reviewLabel: REVIEW_LABEL }); return;
      }
      if (method === "GET" && path === "/api/config") { json(response, 200, { studyCategories: STUDY_CATEGORIES, studyFacets: STUDY_FACETS, trainingKinds:TRAINING_KINDS, diagnosisTopics:DIAGNOSIS_TOPICS, topics: TOPICS, difficulties: DIFFICULTIES, languages: LANGUAGES, models: ai.models(), libraryLimit:LIBRARY_LIMIT, languageSyllabus: LANGUAGE_SYLLABUS, interviewTypes: INTERVIEW_TYPES, interviewTopics: INTERVIEW_TOPICS, interviewSources: await interviewSources.status() }); return; }
      if (method === "GET" && path === "/api/chats") { json(response, 200, { threads: chats.list(), activeJob: tasks.activeJob() }); return; }
      if (method === "POST" && path === "/api/chats") { await body(request); json(response, 201, await chats.create()); return; }
      const chat = path.match(/^\/api\/chats\/([\w-]+)$/);
      if (method === "GET" && chat) { json(response, 200, chats.get(chat[1])); return; }
      if (method === "DELETE" && chat) {
        if (tasks.activeJob()?.chatId === chat[1]) throw new AppError(409, formatMessage('zh', "ui.pleaseStopGeneratingThisConversationBeforeDeletingIt"));
        await chats.delete(chat[1]); json(response, 200, { deleted: true }); return;
      }
      const chatMessage = path.match(/^\/api\/chats\/([\w-]+)\/(messages|retry)$/);
      if (method === "POST" && chatMessage) {
        ensureModelReady(); const job = await chatTasks.chat(chats, chatMessage[1], await body(request), chatMessage[2] === "retry");
        json(response, 202, { jobId: job.id, chatId: chatMessage[1] }); return;
      }
      const teacherProblem = path.match(/^\/api\/problems\/([\w-]+)\/teacher$/);
      if (method === "POST" && teacherProblem) { await body(request); json(response, 200, await chats.teacher(teacherProblem[1])); return; }
      const teacher = path.match(/^\/api\/teachers\/([\w-]+)$/);
      if (method === "GET" && teacher) { json(response, 200, chats.getTeacher(teacher[1])); return; }
      const teacherMessage = path.match(/^\/api\/teachers\/([\w-]+)\/messages$/);
      if (method === "POST" && teacherMessage) {
        ensureModelReady(); const input = object(await body(request));
        if (input.trigger === "observe" && store.snapshot().settings?.teacher?.trigger === "manual") throw new AppError(409, formatMessage('zh', "ui.theRealTimeTeacherIsSetToManual"));
        const job = await chatTasks.teacher(chats, teacherMessage[1], input);
        json(response, 202, { jobId: job.id, chatId: teacherMessage[1] }); return;
      }
      if (method === 'GET' && path === '/api/study/catalog') {
        const q = (url.searchParams.get('q') ?? '').toLowerCase(), category = url.searchParams.get('category'), language = url.searchParams.get('language');
        json(response, 200, { points: study.points().filter(p => (!category || category === 'all' || p.category === category) && (!language || !p.language || p.language === language) && (!q || [p.title,p.topic,p.description].join(' ').toLowerCase().includes(q))) }); return;
      }
      if (method === 'GET' && path === '/api/breadth') { json(response, 200, study.breadthOverview()); return; }
      if (method === 'POST' && path === '/api/study/points') { json(response, 201, await study.add(await body(request))); return; }
      if (method === 'POST' && path === '/api/study/import') { ensureModelReady(); const v = object(await body(request)); const job = await studyTasks.importStudy(text(v.kind,30),text(v.id,100)); json(response,202,{jobId:job.id}); return; }
      if (method === 'POST' && path === '/api/study/batches') { ensureModelReady(); const job = await studyTasks.generateStudy(studySelection(await body(request))); json(response,202,{jobId:job.id}); return; }
      const studyBatch = path.match(/^\/api\/study\/batches\/([\w-]+)$/);
      if (method === 'GET' && studyBatch) { json(response,200,publicBatch(study.batch(studyBatch[1]))); return; }
      if (method === 'PUT' && studyBatch) { await study.save(studyBatch[1],await body(request)); json(response,200,{saved:true}); return; }
      const studyReveal = path.match(/^\/api\/study\/batches\/([\w-]+)\/items\/([\w-]+)\/reveal$/);
      if (method === 'POST' && studyReveal) { await body(request); json(response,200,await study.reveal(studyReveal[1],studyReveal[2])); return; }
      const studyClose = path.match(/^\/api\/study\/batches\/([\w-]+)\/close$/);
      if (method === 'POST' && studyClose) { await body(request); json(response,200,await study.closeBatch(studyClose[1])); return; }
      const studyReview = path.match(/^\/api\/study\/batches\/([\w-]+)\/review$/);
      if (method === 'POST' && studyReview) { ensureModelReady(); const job = await studyTasks.reviewStudy(studyReview[1],await body(request)); json(response,202,{jobId:job.id}); return; }
      if(method==="GET"&&path==="/api/library"){
        const q=(url.searchParams.get("q")??"").toLowerCase(),category=url.searchParams.get("category"),kind=url.searchParams.get("kind"),tag=url.searchParams.get("tag");
        const items=library.all().filter(i=>(!category||i.category===category)&&(!kind||i.kind===kind)&&(!tag||i.tags.includes(tag))&&(!q||[i.title,i.filename,i.summary,i.notes,...i.tags,i.extractedText].join("\n").toLowerCase().includes(q))).reverse().map(librarySummary);
        json(response,200,{items});return;
      }
      if(method==="POST"&&path==="/api/library/files"){
        if(Number(request.headers["content-length"])>LIBRARY_LIMIT)throw new AppError(413,formatMessage('zh', "ui.fileExceedsMB"));
        let filename:string;try{filename=decodeURIComponent(request.headers["x-file-name"] as string??"");}catch{throw new AppError(400,formatMessage('zh', "ui.invalidFileName"));}
        text(filename,500);let length=0;const chunks:Buffer[]=[];
        for await(const chunk of request){length+=chunk.length;if(length>LIBRARY_LIMIT)throw new AppError(413,formatMessage('zh', "ui.fileExceedsMB"));chunks.push(chunk);}
        const result=await library.importFile(filename,Buffer.concat(chunks));json(response,result.duplicate?200:201,{item:librarySummary(result.item),duplicate:result.duplicate});return;
      }
      if(method==="POST"&&path==="/api/library/urls"){
        const input=object(await body(request));const result=await library.importURL(text(input.url,2000));json(response,result.duplicate?200:201,{item:librarySummary(result.item),duplicate:result.duplicate});return;
      }
      if(method==="POST"&&path==="/api/library/import-existing"){
        await body(request);const ids=sourceDir?await library.importExisting(sourceDir):[];json(response,200,{imported:ids.length,ids});return;
      }
      if(method==="POST"&&path==="/api/library/organize"){
        ensureModelReady();const input=object(await body(request));if(!Array.isArray(input.ids)||input.ids.some(id=>typeof id!=="string"))throw new AppError(400,formatMessage('zh', "ui.pleaseChooseTheMaterialsToOrganize"));
        const job=await libraryTasks.organizeLibrary(input.ids as string[]);json(response,202,{jobId:job.id});return;
      }
      const libraryItem=path.match(/^\/api\/library\/([\w-]+)$/);
      if(method==="GET"&&libraryItem){const i=library.get(libraryItem[1]);json(response,200,{...librarySummary(i),extractedText:i.extractedText,pages:i.pages?.map(({text:_,...p})=>p)});return;}
      if(method==="PUT"&&libraryItem){const i=await library.edit(libraryItem[1],await body(request));json(response,200,librarySummary(i));return;}
      const original=path.match(/^\/api\/library\/([\w-]+)\/original$/);
      if(method==="GET"&&original){const{item,data}=await library.original(original[1]);response.writeHead(200,{"Content-Type":item.mime,"Cache-Control":"no-store","Content-Disposition":`${url.searchParams.get("download")==="1"?"attachment":"inline"}; filename*=UTF-8''${encodeURIComponent(item.filename)}`});response.end(data);return;}
      if (method === "GET" && path === "/api/settings") { json(response, 200, await modelSettings()); return; }
      if (method === "PUT" && path === "/api/settings") {
        const input = object(await body(request));
        const ids = input.visibleModels;
        if (ids === undefined && input.teacher === undefined && input.uiLanguage === undefined && input.userLanguage === undefined) throw new AppError(400, formatMessage('zh', "ui.chooseSettingsToUpdate"));
        if (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.length > ai.models().length || ids.some(id => typeof id !== "string" || !ai.models().some(option => option.id === id)) || new Set(ids).size !== ids.length)) throw new AppError(400, formatMessage('zh', "ui.selectAtLeastOneValidModelWithoutDuplicates"));
        const teacher = input.teacher === undefined ? undefined : teacherSettings(input.teacher);
        for (const key of ["uiLanguage", "userLanguage"] as const) {
          if (input[key] !== undefined && !isLocale(input[key])) throw new AppError(400, formatMessage('zh', "ui.chooseChineseEnglishOrJapanese"));
        }
        const uiLanguage = isLocale(input.uiLanguage) ? input.uiLanguage : undefined;
        const userLanguage = isLocale(input.userLanguage) ? input.userLanguage : undefined;
        ensureModelReady(); modelChanging = true;
        try {
          const { model } = await ai.status();
          if (Array.isArray(ids) && !ids.includes(model)) throw new AppError(400, formatMessage('zh', "ui.keepTheCurrentModelVisibleSwitchModelsBefore"));
          await store.update(state => { state.settings = { ...state.settings, model, ...(Array.isArray(ids) ? { visibleModels: [...ids] } : {}), ...(teacher ? { teacher } : {}), ...(uiLanguage ? { uiLanguage } : {}), ...(userLanguage ? { userLanguage } : {}) }; });
        } finally { modelChanging = false; }
        json(response, 200, await modelSettings()); return;
      }
      if (method === "PUT" && path === "/api/model") {
        const model = text(object(await body(request)).model, 150);
        ensureModelReady();
        if (tasks.activeJob()) throw new AppError(409, formatMessage('zh', "ui.pleaseWaitForOrCancelTheCurrentTask"));
        if (!ai.models().some(option => option.id === model)) throw new AppError(400, formatMessage('zh', "ui.pleaseChooseACodexModelFromTheList"));
        modelChanging = true;
        try {
          if (!(await modelSettings()).visibleModels.includes(model)) throw new AppError(400, formatMessage('zh', "ui.thisModelIsHiddenEnableItInSettings"));
          await store.update(state => { state.settings = { ...state.settings, model }; });
          ai.setModel(model);
        } finally { modelChanging = false; }
        json(response, 200, await ai.status()); return;
      }
      if (method === "GET" && path === "/api/auth/status") { json(response, 200, await ai.status()); return; }
      if (method === "POST" && path === "/api/auth/login") {
        await body(request);
        if (tasks.activeJob()) throw new AppError(409, formatMessage('zh', "ui.pleaseWaitForOrCancelTheCurrentTask2"));
        const login = auth.start(); json(response, 202, { id: login.id }); return;
      }
      const authEvents = path.match(/^\/api\/auth\/([\w-]+)\/events$/);
      if (method === "GET" && authEvents) { auth.get(authEvents[1]).events.connect(response, after); return; }
      const authAnswer = path.match(/^\/api\/auth\/([\w-]+)\/answer$/);
      if (method === "POST" && authAnswer) {
        const input = object(await body(request)); auth.answer(authAnswer[1], text(input.promptId, 100), text(input.value, 10000)); json(response, 200, { ok: true }); return;
      }
      if (method === "POST" && path === "/api/auth/cancel") { await body(request); await auth.stop(); json(response, 200, { ok: true }); return; }
      if (method === "POST" && path === "/api/problems") {
        ensureModelReady();
        const job = await algorithmTasks.generate(selection(await body(request))); json(response, 202, { jobId: job.id }); return;
      }
      if (method === "POST" && path === "/api/language-drills") {
        ensureModelReady();
        const job = await languageTasks.generateLanguage(languageSelection(await body(request))); json(response, 202, { jobId: job.id }); return;
      }
      if (method === "POST" && path === "/api/interview-jobs") {
        const job = await importJob(await body(request), options.jobReader);
        await store.update(state => { (state.interviewJobs ??= []).push(job); });
        json(response, 201, job); return;
      }
      if(method==="POST"&&path==="/api/trainings/diagnosis"){
        ensureModelReady();const job=await trainingTasks.generateDiagnosis(diagnosisSelection(await body(request)));json(response,202,{jobId:job.id});return;
      }
      if(method==="POST"&&path==="/api/trainings"){
        json(response,201,await trainings.create(await body(request)));return;
      }
      const training=path.match(/^\/api\/trainings\/([\w-]+)$/);
      if(method==="GET"&&training){json(response,200,publicTraining(store.training(training[1])));return;}
      if(method==="PUT"&&training){await trainings.saveDraft(training[1],await body(request));json(response,200,{saved:true});return;}
      const trainingAction=path.match(/^\/api\/trainings\/([\w-]+)\/(analyze|rewrite|next|review|reveal)$/);
      if(method==="POST"&&trainingAction){const [,id,action]=trainingAction;
        if(action==="reveal"){await body(request);json(response,200,await trainings.reveal(id));return;}
        ensureModelReady();const job=await trainingTasks.train(id,action,await body(request));json(response,202,{jobId:job.id});return;
      }
      if (method === "POST" && path === "/api/interviews") {
        ensureModelReady(); const job = await interviewTasks.generateInterview(interviewSelection(await body(request))); json(response, 202, { jobId: job.id }); return;
      }
      const interview = path.match(/^\/api\/interviews\/([\w-]+)$/);
      const interviewVoiceSettings = path.match(/^\/api\/interviews\/([\w-]+)\/voice-settings$/);
      if (method === "PUT" && interviewVoiceSettings) { json(response,200,await voiceInterviews.saveSettings(interviewVoiceSettings[1],await body(request))); return; }
      const interviewVoiceContent = path.match(/^\/api\/interviews\/([\w-]+)\/voice-content$/);
      if (method === "POST" && interviewVoiceContent) { ensureModelReady(); json(response,200,await voiceInterviews.prepare(interviewVoiceContent[1],await body(request))); return; }
      if (method === "GET" && interview) { json(response, 200, publicInterview(store.interview(interview[1]))); return; }
      if (method === "PUT" && interview) {
        const answers = interviewAnswers(await body(request), store.interview(interview[1]));
        await store.update(state => { const item = state.interviews!.find(s => s.id === interview[1])!; Object.assign(item.answers, answers); item.updatedAt = new Date().toISOString(); });
        json(response, 200, { saved: true }); return;
      }
      const interviewReview = path.match(/^\/api\/interviews\/([\w-]+)\/review$/);
      if (method === "POST" && interviewReview) {
        ensureModelReady(); const answers = interviewAnswers(await body(request), store.interview(interviewReview[1]), true);
        const job = await interviewTasks.reviewInterview(interviewReview[1], answers); json(response, 202, { jobId: job.id }); return;
      }
      const drill = path.match(/^\/api\/language-drills\/([\w-]+)$/);
      if (method === "GET" && drill) { json(response, 200, store.languageDrill(drill[1])); return; }
      if (method === "PUT" && drill) {
        const code = codeInput(await body(request)); store.languageDrill(drill[1]);
        await store.update(state => { const item = state.languageDrills!.find(d => d.id === drill[1])!; item.code = code; item.updatedAt = new Date().toISOString(); });
        json(response, 200, { saved: true }); return;
      }
      const reveal = path.match(/^\/api\/language-drills\/([\w-]+)\/reveal$/);
      if (method === "POST" && reveal) {
        await body(request); store.languageDrill(reveal[1]);
        const revealedAt = await store.update(state => { const item = state.languageDrills!.find(d => d.id === reveal[1])!; item.revealedAt ??= new Date().toISOString(); return item.revealedAt; });
        json(response, 200, { revealedAt }); return;
      }
      const problem = path.match(/^\/api\/problems\/([\w-]+)$/);
      if (method === "GET" && problem) { json(response, 200, store.problem(problem[1])); return; }
      if (method === "PUT" && problem) {
        const code = codeInput(await body(request)); store.problem(problem[1]);
        await store.update(state => { const item = state.problems.find(p => p.id === problem[1])!; item.code = code; item.updatedAt = new Date().toISOString(); });
        json(response, 200, { saved: true }); return;
      }
      const action = path.match(/^\/api\/problems\/([\w-]+)\/(hint|review)$/);
      if (method === "POST" && action) {
        ensureModelReady();
        const code = codeInput(await body(request));
        const job = await (action[2] === "hint" ? algorithmTasks.hint(action[1], code) : algorithmTasks.review(action[1], code));
        json(response, 202, { jobId: job.id }); return;
      }
      if (method === "POST" && path === "/api/analysis") { ensureModelReady(); await body(request); const job = await algorithmTasks.analyze(); json(response, 202, { jobId: job.id }); return; }
      const jobEvents = path.match(/^\/api\/jobs\/([\w-]+)\/events$/);
      if (method === "GET" && jobEvents) { tasks.get(jobEvents[1]).events.connect(response, after); return; }
      const abort = path.match(/^\/api\/jobs\/([\w-]+)\/abort$/);
      if (method === "POST" && abort) { await body(request); await tasks.abort(abort[1]); json(response, 200, { ok: true }); return; }
      const jobInfo = path.match(/^\/api\/jobs\/([\w-]+)$/);
      if (method === "GET" && jobInfo) { const job = tasks.get(jobInfo[1]); json(response, 200, { id: job.id, kind: job.kind, status: job.status, result: job.result, error: job.error }); return; }
      const bundle = path.match(/^\/assets\/([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\.(js|css|ttf|txt))$/);
      const pdfResource=path.match(/^\/assets\/pdf\/(cmaps|standard_fonts|wasm)\/([a-zA-Z0-9_.-]+)$/);
      if(method==="GET"&&pdfResource){let data:Buffer;try{data=await readFile(resolve(root,"node_modules/pdfjs-dist",pdfResource[1],pdfResource[2]));}catch{throw new AppError(404,formatMessage('zh', "ui.pDFResourceNotFound"));}response.writeHead(200,{"Content-Type":pdfResource[2].endsWith(".wasm")?"application/wasm":pdfResource[2].endsWith(".js")?"text/javascript":"application/octet-stream","Cache-Control":"public, max-age=86400"});response.end(data);return;}
      if (method === "GET" && bundle) {
        const mime: Record<string, string> = { js: "text/javascript", css: "text/css", ttf: "font/ttf", txt: "text/plain" };
        let content: Buffer;
        try { content = await readFile(resolve(root, "public/assets", bundle[1])); }
        catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new AppError(404, formatMessage('zh', "ui.resourceNotFound"));
          throw error;
        }
        response.writeHead(200, { "Content-Type": mime[bundle[2]], "Cache-Control": "no-cache" }); response.end(content); return;
      }
      const assets: Record<string, [string, string]> = { "/": ["index.html", "text/html"], "/style.css": ["style.css", "text/css"], "/voice-test-1.wav": ["voice-test-1.wav", "audio/wav"], "/voice-test-2.wav": ["voice-test-2.wav", "audio/wav"], "/interview-test.wav": ["interview-test.wav", "audio/wav"] };
      if (method === "GET" && assets[path]) {
        const [file, mime] = assets[path]; response.writeHead(200, { "Content-Type": `${mime}; charset=utf-8`, "Cache-Control": "no-cache" }); const content = await readFile(resolve(root, "public", file));
        const preferences = store.snapshot().settings;
        const uiLanguage = preferences?.uiLanguage ?? DEFAULT_LOCALE, userLanguage = preferences?.userLanguage ?? DEFAULT_LOCALE;
        response.end(file === "index.html" ? content.toString("utf8").replace('<html lang="zh-CN">', `<html lang="${LOCALE_TAGS[uiLanguage]}" data-ui-language="${uiLanguage}" data-user-language="${userLanguage}">`) : content); return;
      }
      throw new AppError(404, formatMessage('zh', "ui.thePageOrEndpointDoesNotExist"));
    } catch (error) {
      diagnostics.record('http','failed',{method:request.method,path:(request.url ?? '/').split('?')[0],status:error instanceof AppError ? error.status : 500,error});
      if (response.headersSent) { response.end(); return; }
      json(response, error instanceof AppError ? error.status : 500, { error: translateSource(error instanceof AppError ? error.message : formatMessage('zh', "ui.theServiceCannotCompleteTheRequestRightNow"), store.snapshot().settings?.uiLanguage ?? DEFAULT_LOCALE) });
    }
  }
  return { server, store, tasks, auth, library, study, voice, voiceInterviews, diagnostics, async close() {
    const closing = new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    await Promise.all([auth.stop(), tasks.stop(), voice.close()]);
    server.closeAllConnections(); await closing; await store.flush();
    diagnostics.record('server','closed'); await diagnostics.flush();
  } };
}
