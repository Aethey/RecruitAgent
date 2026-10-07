import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { libraryImage, scannedPDF } from "./library-fixtures.ts";
import { createApp } from "../src/app/http.ts";
import { Store } from "../src/shared/persistence/store.ts";
import { Library, fileType, type PublicResourceReader } from "../src/features/library/service.ts";
import { FakeAI, fakeInterviewSources } from "./fixtures.ts";

async function setup(t:{after(fn:()=>Promise<void>):void},reader?:PublicResourceReader){
  const dataDir=await mkdtemp(join(tmpdir(),"library-test-")),ai=new FakeAI();
  const app=await createApp({dataDir,ai,interviewSources:fakeInterviewSources,sourceDir:null,libraryReader:reader});
  await new Promise<void>(r=>app.server.listen(0,"127.0.0.1",r));const address=app.server.address();assert(address&&typeof address!=="string");const base=`http://127.0.0.1:${address.port}`;
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  async function request(path:string,method="GET",data?:unknown){const response=await fetch(base+path,{method,headers:data===undefined?{}:{"Content-Type":"application/json"},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,data:await response.json()};}
  async function upload(name:string,bytes:Buffer){const response=await fetch(base+"/api/library/files",{method:"POST",headers:{"X-File-Name":encodeURIComponent(name),"Content-Type":"application/octet-stream"},body:new Uint8Array(bytes)});return {status:response.status,data:await response.json()};}
  async function organize(ids:string[]){const response=await request("/api/library/organize","POST",{ids});assert.equal(response.status,202);const job=app.tasks.get(response.data.jobId);await job.promise;return job;}
  return {app,ai,dataDir,base,request,upload,organize};
}

test("library retains originals, deduplicates, searches full text and persists manual organization",async t=>{
  const {app,ai,dataDir,base,request,upload}=await setup(t),bytes=Buffer.from("# 架构笔记\n\n状态与职责。 searchable-deep-body\n"),result=await upload("../架构笔记.md",bytes);assert.equal(result.status,201);const id=result.data.item.id;
  assert.equal(result.data.item.title,"架构笔记");assert(!("blob" in result.data.item));assert.equal((await upload("笔记.md",bytes)).data.duplicate,true);assert.equal(app.library.all().length,1);
  assert.deepEqual(Buffer.from(await(await fetch(`${base}/api/library/${id}/original?download=1`)).arrayBuffer()),bytes);
  assert.equal((await request("/api/library?q=searchable-deep-body")).data.items.length,1);
  const patch={title:"状态边界",category:"架构",tags:["Flutter","Flutter"],notes:"保留自己的备注"};assert.equal((await request(`/api/library/${id}`,"PUT",patch)).status,200);
  assert.equal((await request("/api/library?category="+encodeURIComponent("架构")+"&tag=Flutter")).data.items.length,1);assert.equal((await request("/api/library?kind=image")).data.items.length,0);
  const state=(await request("/api/state")).data;assert(!("extractedText" in state.library[0]));assert(!("blob" in state.library[0]));assert.equal(ai.prompts.length,0);
  const restored=new Store(join(dataDir,"state.json"));await restored.load();assert.equal(restored.snapshot().library![0].notes,patch.notes);assert.deepEqual(restored.snapshot().library![0].tags,["Flutter"]);
});
test("existing sources are copied once and later changes preserve both versions and source files",async t=>{
  const {app,dataDir}=await setup(t),sources=join(dataDir,"sources");await mkdir(join(sources,"questions"),{recursive:true});const path=join(sources,"questions","经验.md");await writeFile(path,"# 经历\n第一版");
  assert.equal((await app.library.importExisting(sources)).length,1);assert.equal((await app.library.importExisting(sources)).length,0);await writeFile(path,"# 经历\n第二版");assert.equal((await app.library.importExisting(sources)).length,1);assert.equal(app.library.all().length,2);assert.equal(await readFile(path,"utf8"),"# 经历\n第二版");
});
test("URL imports extract visible content, handle binary documents and reject private targets",async t=>{
  const image=libraryImage().png;let calls=0;
  const reader:PublicResourceReader=async url=>{calls++;if(url.endsWith("image"))return {url,mime:"image/png",data:image};if(url.endsWith("notes.md"))return {url,mime:"text/markdown",data:Buffer.from("# 远程笔记\n原文内容")};return {url,mime:"text/html",data:Buffer.from("<title>工程资料</title><script>SECRET_JS</script><nav>NO_NAV</nav><main><h1>状态管理</h1><p>公开资料正文，说明状态、事件和职责边界，应保留原始内容供浏览。本文足够长，可以作为实际可读取的资料。</p></main>")};};
  const {app,request,upload}=await setup(t,reader);const result=await request("/api/library/urls","POST",{url:"https://example.com/article"});assert.equal(result.status,201);const item=app.library.get(result.data.item.id);assert(item.extractedText.includes("职责边界"));assert(!item.extractedText.includes("SECRET_JS"));assert(!item.extractedText.includes("NO_NAV"));
  assert.equal((await request("/api/library/urls","POST",{url:"https://example.com/article"})).data.duplicate,true);assert.equal(calls,1);
  assert.equal((await request("/api/library/urls","POST",{url:"http://127.0.0.1/private"})).status,400);assert.equal(calls,1);
  assert.equal((await request("/api/library/urls","POST",{url:"https://example.com/notes.md"})).data.item.kind,"markdown");
  const uploaded=await upload("original.png",image);const duplicate=await request("/api/library/urls","POST",{url:"https://example.com/image"});assert.equal(duplicate.data.duplicate,true);assert.equal(app.library.get(uploaded.data.item.id).url,undefined);
});
test("image organization passes real PNG attachments to a vision model without changing selected text model",async t=>{
  const {app,ai,upload,organize}=await setup(t),result=await upload("vision.png",libraryImage().png),id=result.data.item.id;const job=await organize([id]);assert.equal(job.status,"done");assert.deepEqual(job.result,{libraryIds:[id],failedIds:[]});
  assert.equal(ai.requestedModels[0],"test-small");assert.equal(ai.model,"test-model");const image=ai.requestedImages[0][0];assert.equal(image.mimeType,"image/png");assert.equal(image.type,"image");assert.equal(Buffer.from(image.data,"base64")[0],137);
  const item=app.library.get(id);assert.equal(item.status,"ready");assert.equal(item.visionModel,"test-small");assert.equal(item.organizedModel,"test-small");assert(item.extractedText.includes("视觉识别"));
});
test("scanned PDF pages are rendered, visually read and retained before summarization",async t=>{
  const {app,ai,upload,organize,base}=await setup(t),bytes=scannedPDF(libraryImage().jpeg),result=await upload("scan.pdf",bytes),id=result.data.item.id;assert.equal(result.data.item.pageCount,1);assert.equal(result.data.item.visionPages,1);
  const job=await organize([id]);assert.deepEqual(job.result,{libraryIds:[id],failedIds:[]});assert.equal(ai.requestedImages[0].length,1);assert.equal(ai.requestedImages[1].length,0);assert.deepEqual(ai.requestedModels,["test-small","test-model"]);
  const item=app.library.get(id);assert.equal(item.pages![0].recognized,true);assert(item.extractedText.includes("隔离视觉识别结果"));assert.equal(item.organizedModel,"test-model");assert.equal(item.visionModel,"test-small");
  assert.deepEqual(Buffer.from(await(await fetch(`${base}/api/library/${id}/original`)).arrayBuffer()),bytes);
  for(const path of ["/assets/pdf.worker.js","/assets/pdf/cmaps/Adobe-Japan1-UCS2.bcmap","/assets/pdf/standard_fonts/LiberationSans-Regular.ttf"]){assert.equal((await fetch(base+path)).status,200,path);}
  const wasm=await fetch(base+"/assets/pdf/wasm/openjpeg.wasm");assert.equal(wasm.headers.get("content-type"),"application/wasm");assert.deepEqual(Buffer.from(await wasm.arrayBuffer()).subarray(0,4),Buffer.from([0,97,115,109]));
  const fallback=await fetch(base+"/assets/pdf/wasm/openjpeg_nowasm_fallback.js");assert.equal(fallback.status,200);assert.equal(fallback.headers.get("content-type"),"text/javascript");
});
test("long documents read all chunks, manual edits made during AI survive and cancellation preserves originals",async t=>{
  const {app,ai,upload,organize,request}=await setup(t),long=await upload("long.md",Buffer.from("# 长文\n"+"段落。".repeat(20000)+"END-OF-SOURCE"));await organize([long.data.item.id]);assert.equal(ai.prompts.filter(p=>p.startsWith("为长资料")).length,3);assert(ai.prompts.some(p=>p.includes("END-OF-SOURCE")));
  const image=await upload("manual.png",libraryImage().png),id=image.data.item.id;ai.delay=80;const response=await request("/api/library/organize","POST",{ids:[id]});const job=app.tasks.get(response.data.jobId);await request(`/api/library/${id}`,"PUT",{title:"我的标题",category:"我的分类",tags:["个人"],notes:"手动备注"});await job.promise;assert.equal(app.library.get(id).title,"我的标题");assert.equal(app.library.get(id).notes,"手动备注");assert.equal(app.library.get(id).status,"ready");
  ai.mode="block";const pending=await upload("cancel.md",Buffer.from("# 取消验证\n正文保留"));const blocked=await request("/api/library/organize","POST",{ids:[pending.data.item.id]});assert.equal((await request("/api/library/organize","POST",{ids:[id]})).status,409);assert.equal((await request("/api/model","PUT",{model:"test-small"})).status,409);await app.tasks.stop();await app.tasks.get(blocked.data.jobId).promise;assert.equal(app.tasks.get(blocked.data.jobId).status,"aborted");assert.equal(app.library.get(pending.data.item.id).status,"pending");assert((await app.library.original(pending.data.item.id)).data.length>0);assert.equal(app.library.get(id).title,"我的标题");
});
test("malformed results, failed imports and missing auth never discard valid originals or leak secrets",async t=>{
  const {app,ai,upload,organize,request}=await setup(t);assert.equal((await upload("bad.png",Buffer.from("not an image"))).status,400);assert.throws(()=>fileType("evil.svg",Buffer.from("<svg></svg>")));
  const malformed=await upload("invalid.pdf",Buffer.from("%PDF-1.4\nnot a document"));assert.equal(malformed.data.item.status,"error");assert((await app.library.original(malformed.data.item.id)).data.length>0);
  const record=await upload("notes.md",Buffer.from("# 未整理\n原文")),id=record.data.item.id;ai.mode="malformed";const job=await organize([id]);assert.deepEqual(job.result,{libraryIds:[],failedIds:[id]});assert.equal(app.library.get(id).status,"error");assert.equal(app.library.get(id).summary,"");
  ai.mode="error";await organize([id]);assert(!JSON.stringify((await request(`/api/library/${id}`)).data).includes("PRIVATE_CREDENTIAL"));ai.authenticated=false;assert.equal((await request("/api/library/organize","POST",{ids:[id]})).status,401);assert.equal((await upload("offline.md",Buffer.from("# 离线导入\n无需模型"))).status,201);
  assert.equal((await request("/api/library/organize","POST",{ids:[]})).status,400);assert.equal((await request("/api/library/organize","POST",{ids:[id,id]})).status,400);assert.equal((await request(`/api/library/${id}`,"PUT",{title:"",category:"",tags:[],notes:""})).status,400);
});
