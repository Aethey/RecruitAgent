import { readApiResponse } from './api.ts';
import { element, elements } from './dom.ts';
import { t, ui } from "./i18n.js";
import { marked } from "marked";
import DOMPurify from "dompurify";

/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createLibrary({ $, escape, date, options, pageHeading, list, api, toast, startTask, updateButtons, getState, getAccount, isBusy }) {
  const labels = { pdf: "PDF", markdown: "Markdown", image: t("图片"), url: t("网页") };
  const statuses = { pending: t("待整理"), ready: t("已整理"), error: t("需要重试") };
  let filter={search:"",category:"",kind:"",tag:""}, searchTimer=null, importBusy=false, currentId=null, activeItem=null, loadingTask=null, renderTask=null, pdf=null, pageNumber=1, resizeObserver=null, generation=0, view="reader",drawGeneration=0;
  function dispose(){generation++;clearTimeout(searchTimer);resizeObserver?.disconnect();resizeObserver=null;renderTask?.cancel();renderTask=null;void loadingTask?.destroy().catch(()=>{});loadingTask=null;pdf=null;currentId=null;activeItem=null;}
  function safeMarkdown(value){
    const html=DOMPurify.sanitize(marked.parse(value,{async:false,gfm:true}),{USE_PROFILES:{html:true},FORBID_TAGS:["style","form","input","button","textarea","iframe","object","embed","img","video","audio"]});
    const el=document.createElement("div");el.innerHTML=html;
    el.querySelectorAll("a").forEach(a=>{const href=a.getAttribute("href");if(!href)return;try{const u=new URL(href,location.href);if(!["https:","http:"].includes(u.protocol))a.removeAttribute("href");else{a.href=u.href;a.target="_blank";a.rel="noopener noreferrer";}}catch{a.removeAttribute("href");}});return el.innerHTML;
  }
  async function refresh(){const response=await api("/api/library");getState().library=response.items;return response.items;}
  function renderList(){
    dispose();
    const records=getState().library??[],categories=[...new Set(records.map(i=>i.category))].sort(),pending=records.filter(i=>i.status!=="ready");
    $("#page").innerHTML=pageHeading("YOUR LOCAL LIBRARY",t("把资料，放到找得到的地方。"),t("原文件、原文和整理结果保存在本机，需要时再回来浏览。"))+ui`
      <section class="library-import-grid"><div class="card flat"><div class="section-heading"><div><h2>添加本地文件</h2><p class="card-subtitle">PDF、Markdown 和图片，可以一次选择多个。</p></div></div><form id="library-file-form" class="library-import-form"><label class="file-drop pressed" for="library-files"><span>＋ 选择文件</span><small>每份最多20 MB · PDF最多200页</small><input id="library-files" type="file" multiple accept=".pdf,.md,.markdown,.png,.jpg,.jpeg,.webp,.gif,.avif" aria-label="资料文件"></label><p id="library-file-names" class="interview-help">还没有选择文件。</p><label class="library-check"><input type="checkbox" id="library-auto-file" checked>导入后自动整理</label><button type="submit" class="button primary" id="library-upload">导入文件 →</button></form></div>
      <div class="card flat"><div class="section-heading"><div><h2>添加 URL</h2><p class="card-subtitle">网页正文、PDF、Markdown 或图片链接。</p></div></div><form id="library-url-form" class="library-import-form"><label for="library-urls" class="field-label">每行一个链接，最多5个</label><textarea id="library-urls" rows="4" placeholder="https://…" required></textarea><label class="library-check"><input type="checkbox" id="library-auto-url" checked>导入后自动整理</label><button type="submit" class="button mint" id="library-import-url">读取并导入 →</button></form></div></section>
      <div id="library-import-status" class="library-import-status" role="status"></div><p class="library-cost-note">自动整理使用顶部所选 Codex 模型；图片及扫描/含图 PDF 自动使用可用的视觉模型。原文提取、浏览和筛选不调用模型。</p>
      <section class="library-toolbar"><div><h2>资料库 <span id="library-total">${records.length}</span></h2><p class="interview-help">上传的资料保存在本机；面试练习中可以选择资料的用途。</p></div><div class="library-toolbar-actions"><button type="button" class="button flat" id="library-sync">同步现有资料</button><button type="button" class="button primary" id="library-organize-pending" data-ai>整理待处理 · ${pending.length}</button></div></section>
      <div class="filters library-filters"><label for="library-search" class="sr-only">搜索资料</label><input id="library-search" placeholder="搜索标题、标签、备注或原文…" value="${escape(filter.search)}"><label for="library-category" class="sr-only">资料分类</label><select id="library-category">${options(Object.fromEntries(categories.map(c=>[c,c])),filter.category,t("全部分类"))}</select><label for="library-kind" class="sr-only">资料类型</label><select id="library-kind">${options(labels,filter.kind,t("全部类型"))}</select></div><div id="library-tag-filter" class="library-tag-filter" ${filter.tag?"":"hidden"}></div><div id="library-list" class="library-grid"></div>`;
    $("#library-files").onchange=()=>{$("#library-file-names").textContent=[...$("#library-files").files].map(f=>f.name).join(" · ")||t("还没有选择文件。");};
    $("#library-search").oninput=e=>{filter.search=e.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>void loadList(),250);};
    $("#library-category").onchange=e=>{filter.category=e.target.value;void loadList();};$("#library-kind").onchange=e=>{filter.kind=e.target.value;void loadList();};
    $("#library-file-form").onsubmit=async e=>{
      e.preventDefault();if(importBusy)return;const files=[...$("#library-files").files],auto=$("#library-auto-file").checked;
      if(!files.length||files.length>20){toast(t("请选择1–20个文件。"));return;}
      if(files.some(f=>f.size>20*1024*1024)){toast(t("单个文件不能超过20 MB。"));return;}
      await importBatch(files,async file=>{
        const r=await fetch("/api/library/files",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-File-Name":encodeURIComponent(file.name)},body:file});return readApiResponse('POST /api/library/files',r,t);
      },auto,f=>f.name);
    };
    $("#library-url-form").onsubmit=async e=>{e.preventDefault();if(importBusy)return;const urls=[...new Set($("#library-urls").value.split(/\n/).map(s=>s.trim()).filter(Boolean))];if(!urls.length||urls.length>5){toast(t("请输入1–5个公开链接。"));return;}await importBatch(urls,url=>api("/api/library/urls","POST",{url}),$("#library-auto-url").checked,url=>url);};
    $("#library-sync").onclick=async()=>{const b=$("#library-sync");b.disabled=true;try{const r=await api("/api/library/import-existing","POST",{});await refresh();if(location.hash==="#library")renderList();toast(ui`已同步，新增${r.imported}份资料。`);}catch(e){toast(e.message);}finally{if(b.isConnected)b.disabled=false;}};
    $("#library-organize-pending").onclick=()=>{if(!pending.length){toast(t("目前没有待整理的资料。"));return;}void startTask("/api/library/organize",{ids:pending.slice(0,20).map(i=>i.id)},"library");};
    void loadList();updateButtons();
  }
  async function loadList(){
    const query=new URLSearchParams({q:filter.search,category:filter.category,kind:filter.kind,tag:filter.tag}).toString();
    try{const{items}=await api(`/api/library?${query}`);if(!$("#library-list")||query!==new URLSearchParams({q:filter.search,category:filter.category,kind:filter.kind,tag:filter.tag}).toString())return;
      $("#library-tag-filter").hidden=!filter.tag;$("#library-tag-filter").innerHTML=filter.tag?ui`<button class="tag" id="library-clear-tag">标签：${escape(filter.tag)} ×</button>`:"";if($("#library-clear-tag"))$("#library-clear-tag").onclick=()=>{filter.tag="";void loadList();};
      $("#library-list").innerHTML=items.length?items.map(i=>ui`<article class="card flat library-card"><div class="tags"><span class="tag">${labels[i.kind]}</span><span class="tag ${i.status==="ready"?"easy":i.status==="error"?"hard":"medium"}">${statuses[i.status]}</span></div><a class="library-title" href="#library/${i.id}"><h3>${escape(i.title)}</h3></a><p class="library-excerpt">${escape(i.summary||i.error||t("原文件已保存，点击进入浏览；整理后将显示摘要与要点。"))}</p><div class="library-tags">${i.tags.map(t=>`<button class="tag" data-library-tag="${escape(t)}">${escape(t)}</button>`).join("")}</div><div class="library-card-footer"><span>${escape(i.category)}</span><span>${date(i.updatedAt)}</span></div><a class="library-open" href="#library/${i.id}">浏览资料 ↗</a></article>`).join(""):t('<div class="card flat empty-small">没有匹配的资料。可以添加文件、URL，或调整搜索条件。</div>');
      elements("[data-library-tag]").forEach(b=>b.onclick=()=>{filter.tag=b.dataset.libraryTag;void loadList();});
    }catch(e){toast(e.message);}
  }
  async function importBatch(values,importOne,auto,label){
    importBusy=true;elements("#library-upload,#library-import-url,#library-sync").forEach(b=>(/** @type {HTMLButtonElement} */ (b)).disabled=true);const ids=[],messages=[];
    try{for(let i=0;i<values.length;i++){
      const status=$("#library-import-status");if(status)status.textContent=ui`导入 ${i+1}/${values.length} · ${label(values[i])}`;
      try{const r=await importOne(values[i]);messages.push(`${r.duplicate?t("已在资料库"):r.item.status==="error"?t("已保存，需要检查"):t("已导入")}：${label(values[i])}${r.item.error?` · ${r.item.error}`:""}`);if(!r.duplicate&&r.item.status!=="error")ids.push(r.item.id);}catch(e){messages.push(ui`未导入：${label(values[i])} · ${e.message}`);}
    }await refresh();if(location.hash==="#library"){renderList();$("#library-import-status").textContent=messages.join("\n");}
    if(auto&&ids.length){if(isBusy())toast(t("原文件已保存。当前有任务，请稍后点击「整理待处理」。"));else if(!getAccount().authenticated)toast(t("原文件已保存。连接 Codex 后点击「整理待处理」。"));else await startTask("/api/library/organize",{ids},"library");}
    }finally{importBusy=false;elements("#library-upload,#library-import-url,#library-sync").forEach(b=>(/** @type {HTMLButtonElement} */ (b)).disabled=false);}
  }
  async function renderDetail(id){
    dispose();currentId=id;activeItem=null;pageNumber=1;const token=generation;
    $("#page").innerHTML=pageHeading("LOCAL LIBRARY",t("正在打开资料…"),"");
    try{const item=await api(`/api/library/${id}`);if(token!==generation)return;activeItem=item;
      $("#page").innerHTML=pageHeading("LOCAL LIBRARY",escape(item.title),`${labels[item.kind]} · ${escape(item.category)} · ${statuses[item.status]}`,t('<a href="#library" class="button flat">返回资料库</a>'))+ui`
        <div class="library-detail-actions"><a class="button flat" href="/api/library/${item.id}/original?download=1" download>下载原文件 ↓</a>${item.url?ui`<a class="button flat" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">打开来源 ↗</a>`:""}<button type="button" class="button primary" id="library-organize-one" data-ai>${item.status==="ready"?t("重新整理"):t("整理这份资料")} ✧</button></div>
        <section class="library-detail-grid"><div><article class="card flat library-reader"><div class="library-reader-tabs"><button class="feedback-tab ${view==="reader"?"active":""}" id="library-reader-tab">${item.kind==="pdf"?t("PDF 阅读"):item.kind==="image"?t("原图"):t("正文阅读")}</button><button class="feedback-tab ${view==="text"?"active":""}" id="library-text-tab">${item.kind==="image"?t("识别文字"):t("原文文本")}</button></div><div id="library-reader-content"></div></article></div><div><article class="card flat library-summary" id="library-metadata-content"></article><article class="card flat library-edit"><h2>整理信息</h2><form id="library-edit-form" class="generator-form"><div class="field"><label for="library-edit-title">标题</label><input id="library-edit-title" maxlength="180" value="${escape(item.title)}" required></div><div class="field"><label for="library-edit-category">分类</label><input id="library-edit-category" maxlength="40" value="${escape(item.category)}" list="library-categories" required><datalist id="library-categories">${[...new Set((getState().library??[]).map(i=>i.category))].map(c=>`<option value="${escape(c)}">`).join("")}</datalist></div><div class="field"><label for="library-edit-tags">标签 · 逗号分隔</label><input id="library-edit-tags" value="${escape(item.tags.join(", "))}"></div><div class="field"><label for="library-edit-notes">我的备注</label><textarea id="library-edit-notes" rows="5" maxlength="20000">${escape(item.notes)}</textarea></div><button type="submit" class="button mint" id="library-save-metadata">保存整理信息</button><p class="form-note" id="library-edit-status" role="status">手动修改后，正在运行的整理不会覆盖这些信息。</p></form></article></div></section>`;
      renderMetadata(item);await renderReader(item,token);if(token!==generation)return;
      $("#library-reader-tab").onclick=()=>{view="reader";void renderReader(item,token);};$("#library-text-tab").onclick=()=>{view="text";void renderReader(item,token);};
      $("#library-organize-one").onclick=()=>void startTask("/api/library/organize",{ids:[item.id]},"library");
      $("#library-edit-form").onsubmit=async e=>{e.preventDefault();const b=$("#library-save-metadata"),status=$("#library-edit-status");b.disabled=true;try{const updated=await api(`/api/library/${id}`,"PUT",{title:$("#library-edit-title").value,category:$("#library-edit-category").value,tags:$("#library-edit-tags").value.split(/[,，]/).map(t=>t.trim()).filter(Boolean),notes:$("#library-edit-notes").value});await refresh();Object.assign(item,updated);if(status.isConnected)status.textContent=t("已保存到本机 ✓");if(currentId===id){$(".page-heading h1").textContent=updated.title;renderMetadata(item);}toast(t("整理信息已保存。"));}catch(e){toast(e.message);}finally{if(b.isConnected)b.disabled=false;}};updateButtons();
    }catch(e){if(token===generation){$("#page").innerHTML=pageHeading("LOCAL LIBRARY",t("资料暂时无法打开"),escape(e.message),t('<a class="button flat" href="#library">返回资料库</a>'));}}
  }
  function renderMetadata(item){
    const el=$("#library-metadata-content");if(!el)return;
    el.innerHTML=ui`<div class="section-heading"><h2>资料摘要</h2><span class="tag ${item.status==="ready"?"easy":"medium"}">${statuses[item.status]}</span></div>${item.error?`<p class="stale-note">${escape(item.error)}</p>`:""}<p class="problem-copy">${escape(item.summary||t("还没有整理摘要。原文件可以直接浏览，点击整理后会生成分类、标签和要点。"))}</p>${item.keyPoints.length?ui`<h3 class="subheading">关键要点</h3>${list(item.keyPoints)}`:""}<div class="tags">${item.tags.map(t=>`<span class="tag">${escape(t)}</span>`).join("")}</div><div class="library-source-info">${item.sourcePath?ui`原始资料：${escape(item.sourcePath)}<br>`:""}${item.pageCount?ui`${item.pageCount} 页 · ${item.visionPages} 页需要视觉读取<br>`:""}${item.organizedModel?ui`整理模型：${escape(item.organizedModel)}<br>`:""}${item.visionModel?ui`视觉模型：${escape(item.visionModel)}<br>`:""}${date(item.updatedAt)} 更新</div><p class="evaluation-note">整理结果由模型生成，请结合原文核对；识别不清的内容保留标记。</p>`;
  }
  async function renderReader(item,token){
    if(token!==generation)return;
    renderTask?.cancel();renderTask=null;resizeObserver?.disconnect();resizeObserver=null;
    $("#library-reader-tab").classList.toggle("active",view==="reader");$("#library-text-tab").classList.toggle("active",view==="text");
    const content=$("#library-reader-content");
    if(view==="text"){content.innerHTML=`<pre class="library-original-text">${escape(item.extractedText||t("尚未取得文字。图片和扫描 PDF 请先点击整理，系统会自动调用视觉模型。"))}</pre>`;return;}
    if(item.kind==="markdown"){content.innerHTML=`<div class="markdown-body">${safeMarkdown(item.extractedText)}</div>`;return;}
    if(item.kind==="url"){content.innerHTML=`<div class="library-web-text">${escape(item.extractedText)}</div>`;return;}
    if(item.kind==="image"){content.innerHTML=`<img class="library-image" src="/api/library/${item.id}/original" alt="${escape(item.title)}">`;return;}
    content.innerHTML=t('<p class="interview-help">正在读取 PDF…</p>');
    try{
      if(!pdf){const pdfjs=await import("pdfjs-dist/build/pdf.mjs");if(token!==generation)return;pdfjs.GlobalWorkerOptions.workerSrc="/assets/pdf.worker.js";loadingTask=pdfjs.getDocument({url:`/api/library/${item.id}/original`,cMapUrl:"/assets/pdf/cmaps/",cMapPacked:true,standardFontDataUrl:"/assets/pdf/standard_fonts/",wasmUrl:"/assets/pdf/wasm/",enableXfa:true,verbosity:0});pdf=await loadingTask.promise;}
      if(token!==generation||view!=="reader")return;
      content.innerHTML=ui`<div class="pdf-controls"><button type="button" id="pdf-prev" class="button flat small" aria-label="PDF上一页">←</button><label for="pdf-page">页码</label><input id="pdf-page" type="number" min="1" max="${pdf.numPages}" value="${Math.min(pageNumber,pdf.numPages)}"><span>/ ${pdf.numPages}</span><button type="button" id="pdf-next" class="button flat small" aria-label="PDF下一页">→</button></div><div class="pdf-canvas-wrap"><canvas id="library-pdf-canvas" aria-label="PDF页面"></canvas></div><p class="interview-help" id="pdf-render-status"></p>`;
      pageNumber=Math.min(pageNumber,pdf.numPages);
      const draw=async()=>{
        const drawToken=++drawGeneration;
        const canvas=$("#library-pdf-canvas"),parent=canvas?.parentElement;if(!canvas||!pdf)return;
        if(renderTask){renderTask.cancel();await renderTask.promise.catch(()=>{});}const page=await pdf.getPage(pageNumber);if(drawToken!==drawGeneration||token!==generation||view!=="reader"||!canvas.isConnected)return;
        const original=page.getViewport({scale:1}),scale=Math.max(.1,parent.clientWidth/original.width),ratio=Math.min(devicePixelRatio||1,2),viewport=page.getViewport({scale:scale*ratio});canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.style.width=`${Math.floor(viewport.width/ratio)}px`;canvas.style.height=`${Math.floor(viewport.height/ratio)}px`;
        $("#pdf-page").value=String(pageNumber);$("#pdf-prev").disabled=pageNumber<=1;$("#pdf-next").disabled=pageNumber>=pdf.numPages;
        const render=page.render({canvas,canvasContext:canvas.getContext("2d"),viewport});renderTask=render;
        try{await render.promise;if(renderTask===render)renderTask=null;}catch(e){if(e.name!=="RenderingCancelledException")throw e;}
      };
      const safeDraw=()=>void draw().catch(e=>{const status=$("#pdf-render-status");if(status)status.textContent=ui`页面渲染失败：${e.message}。可以下载原文件查看。`;});
      $("#pdf-prev").onclick=()=>{if(pageNumber>1){pageNumber--;safeDraw();}};$("#pdf-next").onclick=()=>{if(pageNumber<pdf.numPages){pageNumber++;safeDraw();}};
      $("#pdf-page").onchange=e=>{pageNumber=Math.max(1,Math.min(pdf.numPages,Math.floor(Number(e.target.value)||1)));safeDraw();};
      resizeObserver=new ResizeObserver(()=>safeDraw());resizeObserver.observe($(".pdf-canvas-wrap"));await draw();
    }catch(e){if(token===generation&&view==="reader")content.innerHTML=ui`<p class="stale-note">PDF无法在页面显示：${escape(e.message)}。可以下载原文件，或切换原文文本。</p>`;}
  }
  async function taskCompleted(){
    await refresh();if(!currentId){if(location.hash==="#library")renderList();return;}
    const id=currentId,item=await api(`/api/library/${id}`);if(currentId!==id)return;
    for(const [field,key] of [["title","title"],["category","category"],["tags","tags"]]){
      const input=$(`#library-edit-${field}`),previous=key==="tags"?activeItem?.tags.join(", "):activeItem?.[key];
      if(input&&input.value===previous)input.value=key==="tags"?item.tags.join(", "):item[key];
    }
    if(activeItem)Object.assign(activeItem,item);$(".page-heading h1").textContent=item.title;$("#library-organize-one").textContent=item.status==="ready"?t("重新整理 ✧"):t("整理这份资料 ✧");renderMetadata(item);
    if(view==="text")$("#library-reader-content").innerHTML=`<pre class="library-original-text">${escape(item.extractedText)}</pre>`;
  }
  return {renderList,renderDetail,dispose,taskCompleted,hasWorkspace:()=>!!currentId};
}
