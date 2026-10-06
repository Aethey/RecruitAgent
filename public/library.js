import { readApiResponse } from './api.ts';
import { element, elements } from './dom.ts';
import { t, errorText } from "./i18n.js";
import { marked } from "marked";
import DOMPurify from "dompurify";

/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createLibrary({ $, escape, date, options, pageHeading, list, api, toast, startTask, updateButtons, getState, getAccount, isBusy }) {
  const labels = { pdf: "PDF", markdown: "Markdown", image: t("ui.image"), url: t("ui.webPage") };
  const statuses = { pending: t("ui.pendingOrganization"), ready: t("ui.organized"), error: t("ui.needsRetry") };
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
    $("#page").innerHTML=pageHeading(t("chrome.yourLocalLibrary"),t("ui.keepYourMaterialsEasyToFind"),t("ui.originalFilesTextAndSummariesAreSavedLocally"))+`
      <section class="library-import-grid"><div class="card flat"><div class="section-heading"><div><h2>${t("ui.addLocalFiles")}</h2><p class="card-subtitle">${t("ui.pDFMarkdownAndImagesSelectMultipleFilesAt")}</p></div></div><form id="library-file-form" class="library-import-form"><label class="file-drop pressed" for="library-files"><span>${t("ui.chooseFiles")}</span><small>${t("ui.upToMBPerFileUpToPDF")}</small><input id="library-files" type="file" multiple accept=".pdf,.md,.markdown,.png,.jpg,.jpeg,.webp,.gif,.avif" aria-label="${t("ui.materialFiles")}"></label><p id="library-file-names" class="interview-help">${t("ui.noFilesSelected")}</p><label class="library-check"><input type="checkbox" id="library-auto-file" checked>${t("ui.organizeAutomaticallyAfterImport")}</label><button type="submit" class="button primary" id="library-upload">${t("ui.importFiles")}</button></form></div>
      <div class="card flat"><div class="section-heading"><div><h2>${t("ui.addURLs")}</h2><p class="card-subtitle">${t("ui.webPagesPDFsMarkdownOrImageLinks")}</p></div></div><form id="library-url-form" class="library-import-form"><label for="library-urls" class="field-label">${t("ui.oneLinkPerLineUpTo")}</label><textarea id="library-urls" rows="4" placeholder="https://…" required></textarea><label class="library-check"><input type="checkbox" id="library-auto-url" checked>${t("ui.organizeAutomaticallyAfterImport")}</label><button type="submit" class="button mint" id="library-import-url">${t("ui.readAndImport")}</button></form></div></section>
      <div id="library-import-status" class="library-import-status" role="status"></div><p class="library-cost-note">${t("ui.automaticOrganizationUsesTheSelectedCodexModelImages")}</p>
      <section class="library-toolbar"><div><h2>${t("ui.library")} <span id="library-total">${records.length}</span></h2><p class="interview-help">${t("ui.uploadedDocumentsStayOnThisComputerChooseTheir")}</p></div><div class="library-toolbar-actions"><button type="button" class="button flat" id="library-sync">${t("ui.syncExistingMaterials")}</button><button type="button" class="button primary" id="library-organize-pending" data-ai>${t("library.organizePending", { length: pending.length })}</button></div></section>
      <div class="filters library-filters"><label for="library-search" class="sr-only">${t("ui.searchMaterials")}</label><input id="library-search" placeholder="${t("ui.searchTitlesTagsNotesOrText")}" value="${escape(filter.search)}"><label for="library-category" class="sr-only">${t("ui.materialCategory")}</label><select id="library-category">${options(Object.fromEntries(categories.map(c=>[c,c])),filter.category,t("ui.allCategories"))}</select><label for="library-kind" class="sr-only">${t("ui.materialType")}</label><select id="library-kind">${options(labels,filter.kind,t("ui.allTypes"))}</select></div><div id="library-tag-filter" class="library-tag-filter" ${filter.tag?"":"hidden"}></div><div id="library-list" class="library-grid"></div>`;
    $("#library-files").onchange=()=>{$("#library-file-names").textContent=[...$("#library-files").files].map(f=>f.name).join(" · ")||t("ui.noFilesSelected");};
    $("#library-search").oninput=e=>{filter.search=e.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>void loadList(),250);};
    $("#library-category").onchange=e=>{filter.category=e.target.value;void loadList();};$("#library-kind").onchange=e=>{filter.kind=e.target.value;void loadList();};
    $("#library-file-form").onsubmit=async e=>{
      e.preventDefault();if(importBusy)return;const files=[...$("#library-files").files],auto=$("#library-auto-file").checked;
      if(!files.length||files.length>20){toast(t("ui.selectFiles"));return;}
      if(files.some(f=>f.size>20*1024*1024)){toast(t("ui.eachFileMustBeNoLargerThanMB"));return;}
      await importBatch(files,async file=>{
        const r=await fetch("/api/library/files",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-File-Name":encodeURIComponent(file.name)},body:file});return readApiResponse('POST /api/library/files',r,errorText);
      },auto,f=>f.name);
    };
    $("#library-url-form").onsubmit=async e=>{e.preventDefault();if(importBusy)return;const urls=[...new Set($("#library-urls").value.split(/\n/).map(s=>s.trim()).filter(Boolean))];if(!urls.length||urls.length>5){toast(t("ui.enterPublicLinks"));return;}await importBatch(urls,url=>api("/api/library/urls","POST",{url}),$("#library-auto-url").checked,url=>url);};
    $("#library-sync").onclick=async()=>{const b=$("#library-sync");b.disabled=true;try{const r=await api("/api/library/import-existing","POST",{});await refresh();if(location.hash==="#library")renderList();toast(`${t("library.syncedAddedmaterials", { imported: r.imported })}`);}catch(e){toast(e.message);}finally{if(b.isConnected)b.disabled=false;}};
    $("#library-organize-pending").onclick=()=>{if(!pending.length){toast(t("ui.noMaterialsNeedOrganization"));return;}void startTask("/api/library/organize",{ids:pending.slice(0,20).map(i=>i.id)},"library");};
    void loadList();updateButtons();
  }
  async function loadList(){
    const query=new URLSearchParams({q:filter.search,category:filter.category,kind:filter.kind,tag:filter.tag}).toString();
    try{const{items}=await api(`/api/library?${query}`);if(!$("#library-list")||query!==new URLSearchParams({q:filter.search,category:filter.category,kind:filter.kind,tag:filter.tag}).toString())return;
      $("#library-tag-filter").hidden=!filter.tag;$("#library-tag-filter").innerHTML=filter.tag?`<button class="tag" id="library-clear-tag">${t("library.tags", { value1: escape(filter.tag) })}</button>`:"";if($("#library-clear-tag"))$("#library-clear-tag").onclick=()=>{filter.tag="";void loadList();};
      $("#library-list").innerHTML=items.length?items.map(i=>`<article class="card flat library-card"><div class="tags"><span class="tag">${labels[i.kind]}</span><span class="tag ${i.status==="ready"?"easy":i.status==="error"?"hard":"medium"}">${statuses[i.status]}</span></div><a class="library-title" href="#library/${i.id}"><h3>${escape(i.title)}</h3></a><p class="library-excerpt">${escape(i.summary||i.error||t("ui.originalFileSavedOpenItToBrowseSummaries"))}</p><div class="library-tags">${i.tags.map(t=>`<button class="tag" data-library-tag="${escape(t)}">${escape(t)}</button>`).join("")}</div><div class="library-card-footer"><span>${escape(i.category)}</span><span>${date(i.updatedAt)}</span></div><a class="library-open" href="#library/${i.id}">${t("ui.browseMaterial")}</a></article>`).join(""):`<div class="card flat empty-small">${t("ui.noMatchingMaterialsAddFilesOrURLsOr")}</div>`;
      elements("[data-library-tag]").forEach(b=>b.onclick=()=>{filter.tag=b.dataset.libraryTag;void loadList();});
    }catch(e){toast(e.message);}
  }
  async function importBatch(values,importOne,auto,label){
    importBusy=true;elements("#library-upload,#library-import-url,#library-sync").forEach(b=>(/** @type {HTMLButtonElement} */ (b)).disabled=true);const ids=[],messages=[];
    try{for(let i=0;i<values.length;i++){
      const status=$("#library-import-status");if(status)status.textContent=`${t("library.import", { value1: i+1, length: values.length, value3: label(values[i]) })}`;
      try{const r=await importOne(values[i]);messages.push(`${r.duplicate?t("ui.alreadyInLibrary"):r.item.status==="error"?t("ui.savedNeedsChecking"):t("ui.imported")}：${label(values[i])}${r.item.error?` · ${r.item.error}`:""}`);if(!r.duplicate&&r.item.status!=="error")ids.push(r.item.id);}catch(e){messages.push(`${t("library.notImported", { value1: label(values[i]), message: e.message })}`);}
    }await refresh();if(location.hash==="#library"){renderList();$("#library-import-status").textContent=messages.join("\n");}
    if(auto&&ids.length){if(isBusy())toast(t("ui.originalSavedWaitForTheCurrentTaskThen"));else if(!getAccount().authenticated)toast(t("ui.originalSavedConnectCodexThenOrganizePendingMaterials"));else await startTask("/api/library/organize",{ids},"library");}
    }finally{importBusy=false;elements("#library-upload,#library-import-url,#library-sync").forEach(b=>(/** @type {HTMLButtonElement} */ (b)).disabled=false);}
  }
  async function renderDetail(id){
    dispose();currentId=id;activeItem=null;pageNumber=1;const token=generation;
    $("#page").innerHTML=pageHeading(t("chrome.localLibrary"),t("ui.openingMaterial"),"");
    try{const item=await api(`/api/library/${id}`);if(token!==generation)return;activeItem=item;
      $("#page").innerHTML=pageHeading(t("chrome.localLibrary"),escape(item.title),`${labels[item.kind]} · ${escape(item.category)} · ${statuses[item.status]}`,`<a href="#library" class="button flat">${t("ui.backToLibrary")}</a>`)+`
        <div class="library-detail-actions"><a class="button flat" href="/api/library/${item.id}/original?download=1" download>${t("ui.downloadOriginal")}</a>${item.url?`<a class="button flat" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${t("ui.openSource")}</a>`:""}<button type="button" class="button primary" id="library-organize-one" data-ai>${item.status==="ready"?t("ui.organizeAgain"):t("ui.organizeThisMaterial")} ✧</button></div>
        <section class="library-detail-grid"><div><article class="card flat library-reader"><div class="library-reader-tabs"><button class="feedback-tab ${view==="reader"?"active":""}" id="library-reader-tab">${item.kind==="pdf"?t("ui.readPDF"):item.kind==="image"?t("ui.originalImage"):t("ui.readContent")}</button><button class="feedback-tab ${view==="text"?"active":""}" id="library-text-tab">${item.kind==="image"?t("ui.recognizedText"):t("ui.originalText")}</button></div><div id="library-reader-content"></div></article></div><div><article class="card flat library-summary" id="library-metadata-content"></article><article class="card flat library-edit"><h2>${t("ui.organizationDetails")}</h2><form id="library-edit-form" class="generator-form"><div class="field"><label for="library-edit-title">${t("ui.title")}</label><input id="library-edit-title" maxlength="180" value="${escape(item.title)}" required></div><div class="field"><label for="library-edit-category">${t("ui.category")}</label><input id="library-edit-category" maxlength="40" value="${escape(item.category)}" list="library-categories" required><datalist id="library-categories">${[...new Set((getState().library??[]).map(i=>i.category))].map(c=>`<option value="${escape(c)}">`).join("")}</datalist></div><div class="field"><label for="library-edit-tags">${t("ui.tagsCommaSeparated")}</label><input id="library-edit-tags" value="${escape(item.tags.join(", "))}"></div><div class="field"><label for="library-edit-notes">${t("ui.myNotes")}</label><textarea id="library-edit-notes" rows="5" maxlength="20000">${escape(item.notes)}</textarea></div><button type="submit" class="button mint" id="library-save-metadata">${t("ui.saveOrganizationDetails")}</button><p class="form-note" id="library-edit-status" role="status">${t("ui.manualEditsAreKeptEvenIfOrganizationIs")}</p></form></article></div></section>`;
      renderMetadata(item);await renderReader(item,token);if(token!==generation)return;
      $("#library-reader-tab").onclick=()=>{view="reader";void renderReader(item,token);};$("#library-text-tab").onclick=()=>{view="text";void renderReader(item,token);};
      $("#library-organize-one").onclick=()=>void startTask("/api/library/organize",{ids:[item.id]},"library");
      $("#library-edit-form").onsubmit=async e=>{e.preventDefault();const b=$("#library-save-metadata"),status=$("#library-edit-status");b.disabled=true;try{const updated=await api(`/api/library/${id}`,"PUT",{title:$("#library-edit-title").value,category:$("#library-edit-category").value,tags:$("#library-edit-tags").value.split(/[,，]/).map(t=>t.trim()).filter(Boolean),notes:$("#library-edit-notes").value});await refresh();Object.assign(item,updated);if(status.isConnected)status.textContent=t("ui.savedLocally");if(currentId===id){$(".page-heading h1").textContent=updated.title;renderMetadata(item);}toast(t("ui.organizationDetailsSaved"));}catch(e){toast(e.message);}finally{if(b.isConnected)b.disabled=false;}};updateButtons();
    }catch(e){if(token===generation){$("#page").innerHTML=pageHeading(t("chrome.localLibrary"),t("ui.cannotOpenMaterial"),escape(e.message),`<a class="button flat" href="#library">${t("ui.backToLibrary")}</a>`);}}
  }
  function renderMetadata(item){
    const el=$("#library-metadata-content");if(!el)return;
    el.innerHTML=`<div class="section-heading"><h2>${t("ui.materialSummary")}</h2><span class="tag ${item.status==="ready"?"easy":"medium"}">${statuses[item.status]}</span></div>${item.error?`<p class="stale-note">${escape(errorText(item.error))}</p>`:""}<p class="problem-copy">${escape(item.summary||t("ui.noSummaryYetBrowseTheOriginalOrOrganize"))}</p>${item.keyPoints.length?`<h3 class="subheading">${t("ui.keyPoints")}</h3>${list(item.keyPoints)}`:""}<div class="tags">${item.tags.map(t=>`<span class="tag">${escape(t)}</span>`).join("")}</div><div class="library-source-info">${t("library.updated", { value7: item.sourcePath?`${t("library.originalMaterial", { value1: escape(item.sourcePath) })}<br>`:"", value8: item.pageCount?`${t("library.pagesPagesNeedVisionReading", { pageCount: item.pageCount, visionPages: item.visionPages })}<br>`:"", value9: item.organizedModel?`${t("library.organizationModel", { value1: escape(item.organizedModel) })}<br>`:"", value10: item.visionModel?`${t("library.visionModel", { value1: escape(item.visionModel) })}<br>`:"", value11: date(item.updatedAt) })}</div><p class="evaluation-note">${t("ui.aISummariesShouldBeCheckedAgainstTheOriginal")}</p>`;
  }
  async function renderReader(item,token){
    if(token!==generation)return;
    renderTask?.cancel();renderTask=null;resizeObserver?.disconnect();resizeObserver=null;
    $("#library-reader-tab").classList.toggle("active",view==="reader");$("#library-text-tab").classList.toggle("active",view==="text");
    const content=$("#library-reader-content");
    if(view==="text"){content.innerHTML=`<pre class="library-original-text">${escape(item.extractedText||t("ui.noTextExtractedYetOrganizeImagesAndScanned"))}</pre>`;return;}
    if(item.kind==="markdown"){content.innerHTML=`<div class="markdown-body">${safeMarkdown(item.extractedText)}</div>`;return;}
    if(item.kind==="url"){content.innerHTML=`<div class="library-web-text">${escape(item.extractedText)}</div>`;return;}
    if(item.kind==="image"){content.innerHTML=`<img class="library-image" src="/api/library/${item.id}/original" alt="${escape(item.title)}">`;return;}
    content.innerHTML=`<p class="interview-help">${t("ui.loadingPDF")}</p>`;
    try{
      if(!pdf){const pdfjs=await import("pdfjs-dist/build/pdf.mjs");if(token!==generation)return;pdfjs.GlobalWorkerOptions.workerSrc="/assets/pdf.worker.js";loadingTask=pdfjs.getDocument({url:`/api/library/${item.id}/original`,cMapUrl:"/assets/pdf/cmaps/",cMapPacked:true,standardFontDataUrl:"/assets/pdf/standard_fonts/",wasmUrl:"/assets/pdf/wasm/",enableXfa:true,verbosity:0});pdf=await loadingTask.promise;}
      if(token!==generation||view!=="reader")return;
      content.innerHTML=`<div class="pdf-controls"><button type="button" id="pdf-prev" class="button flat small" aria-label="${t("ui.previousPDFPage")}">←</button><label for="pdf-page">${t("ui.pageNumber")}</label><input id="pdf-page" type="number" min="1" max="${pdf.numPages}" value="${Math.min(pageNumber,pdf.numPages)}"><span>/ ${pdf.numPages}</span><button type="button" id="pdf-next" class="button flat small" aria-label="${t("ui.nextPDFPage")}">→</button></div><div class="pdf-canvas-wrap"><canvas id="library-pdf-canvas" aria-label="${t("ui.pDFPage")}"></canvas></div><p class="interview-help" id="pdf-render-status"></p>`;
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
      const safeDraw=()=>void draw().catch(e=>{const status=$("#pdf-render-status");if(status)status.textContent=`${t("library.pageRenderingFailedDownloadTheOriginalToView", { message: e.message })}`;});
      $("#pdf-prev").onclick=()=>{if(pageNumber>1){pageNumber--;safeDraw();}};$("#pdf-next").onclick=()=>{if(pageNumber<pdf.numPages){pageNumber++;safeDraw();}};
      $("#pdf-page").onchange=e=>{pageNumber=Math.max(1,Math.min(pdf.numPages,Math.floor(Number(e.target.value)||1)));safeDraw();};
      resizeObserver=new ResizeObserver(()=>safeDraw());resizeObserver.observe($(".pdf-canvas-wrap"));await draw();
    }catch(e){if(token===generation&&view==="reader")content.innerHTML=`<p class="stale-note">${t("library.pDFCannotBeDisplayedDownloadTheOriginalOr", { value1: escape(e.message) })}</p>`;}
  }
  async function taskCompleted(){
    await refresh();if(!currentId){if(location.hash==="#library")renderList();return;}
    const id=currentId,item=await api(`/api/library/${id}`);if(currentId!==id)return;
    for(const [field,key] of [["title","title"],["category","category"],["tags","tags"]]){
      const input=$(`#library-edit-${field}`),previous=key==="tags"?activeItem?.tags.join(", "):activeItem?.[key];
      if(input&&input.value===previous)input.value=key==="tags"?item.tags.join(", "):item[key];
    }
    if(activeItem)Object.assign(activeItem,item);$(".page-heading h1").textContent=item.title;$("#library-organize-one").textContent=item.status==="ready"?t("ui.organizeAgain2"):t("ui.organizeThisMaterial2");renderMetadata(item);
    if(view==="text")$("#library-reader-content").innerHTML=`<pre class="library-original-text">${escape(item.extractedText)}</pre>`;
  }
  return {renderList,renderDetail,dispose,taskCompleted,hasWorkspace:()=>!!currentId};
}
