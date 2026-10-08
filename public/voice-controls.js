import { t, languageTag, catalogText, errorText } from './i18n.js';
/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createVoiceControls({ api, escape, prefix, initial = {}, tips = false, language = false, preview = false, compact = false, onChange = () => {}, onTest = () => {}, onPreview = () => {}, onError = () => {} }) {
  let settings = {model:'gpt-live-1-codex',voice:'cove',tone:'natural',showTips:true,...(language ? {language:'zh'} : {}),...initial}, catalog = null, alive = true, locked = false, previewActive = false;
  let changes = Promise.resolve(), revision = 0;
  let session = null, loadRevision = 0;
  const $ = name => document.getElementById(prefix+'-'+name);
  const status = check => check?.status === 'available' ? t("ui.voiceReceived") : check?.status === 'failed' ? t("voice.lastCheckFailed") : t("ui.unverified");
  function render() {
    return `<section class="voice-settings card flat" id="${prefix}-settings">
      <div class="section-heading"><div><h2>${t("ui.voiceSettings")}</h2><p class="card-subtitle">${language ? t("ui.chooseTheModelVoiceToneAndInterviewLanguage") : t("ui.chooseTheModelVoiceAndToneBeforeStarting")}</p></div></div>
      <div class="voice-settings-fields${language ? ' voice-settings-with-language' : ''}">
        <div class="field"><label for="${prefix}-model">${t("ui.voiceModel")}</label><select id="${prefix}-model" disabled><option>${t("ui.loading")}</option></select></div>
        <div class="field"><label for="${prefix}-voice">${t("ui.voice")}</label><select id="${prefix}-voice" disabled></select>${preview ? `<button type="button" class="button flat small voice-preview-button" id="${prefix}-preview" aria-pressed="false" disabled>${t("ui.previewVoice")}</button>` : ''}</div>
        <div class="field"><label for="${prefix}-tone">${t("ui.tone")}</label><select id="${prefix}-tone" disabled></select></div>
        ${language ? `<div class="field"><label for="${prefix}-language">${t("ui.interviewLanguage")}</label><select id="${prefix}-language" disabled></select><small class="voice-language-note">${t("ui.languageForQuestionsTipsAndFeedback")}</small></div>` : ''}
      </div>
      ${preview && !compact ? `<p id="${prefix}-preview-note" class="voice-note voice-preview-note" role="status">${t("ui.previewTheCurrentVoiceToneAndLanguageWithout")}</p>` : ''}
      ${tips ? `<label class="voice-tips-choice"><input id="${prefix}-tips" type="checkbox" ${settings.showTips ? 'checked' : ''}> ${t("ui.showAnswerKeyPointTips")}</label><p class="voice-note">${t("ui.whenEnabledShowsOneOrMoreKeyPoints")}</p>` : ''}
      ${compact ? '' : `<p id="${prefix}-selection-note" class="voice-note" role="status">${t("ui.queryingLocalCodex")}</p><button type="button" class="button flat small" id="${prefix}-test-model" disabled>${t("ui.checkSelectedVoiceModel")}</button>
      <details class="voice-model-directory"><summary>${t("ui.viewVoiceModelsAndValidationResults")}</summary><p class="voice-note">${t("ui.codexDoesNotProvideACompleteAccountModel")}</p><div id="${prefix}-models"></div><a href="https://developers.openai.com/api/docs/models" target="_blank" rel="noreferrer">${t("ui.officialModelCatalog")}</a></details>`}
    </section>`;
  }
  function update() {
    if (!alive || !$('settings') || !catalog) return;
    const model = catalog.models.find(m => m.id === settings.model) ?? catalog.models[0]; settings.model = model.id;
    const voices = catalog.voices[model.group];
    if (!voices.includes(settings.voice)) settings.voice = model.group === 'v1' ? catalog.voices.defaultV1 : catalog.voices.defaultV2;
    $('model').innerHTML = catalog.models.map(m => `<option value="`+escape(m.id)+'">'+escape(catalogText(m.label))+(compact ? '' : ' · '+(m.id === settings.model && session?.phase === 'connected' ? t(session.audioVerified ? 'ui.voiceReceived' : 'ui.onCall') : status(m.check)))+`</option>`).join(''); (/** @type {HTMLInputElement} */ ($('model'))).value = settings.model;
    $('voice').innerHTML = voices.map(voice => `<option value="`+escape(voice)+'">'+escape(voice[0].toUpperCase()+voice.slice(1))+`</option>`).join(''); (/** @type {HTMLInputElement} */ ($('voice'))).value = settings.voice;
    $('tone').innerHTML = Object.entries(catalog.tones).map(([id,label]) => `<option value="`+escape(id)+'">'+escape(catalogText(label))+`</option>`).join(''); (/** @type {HTMLInputElement} */ ($('tone'))).value = settings.tone;
    if (language) { $('language').innerHTML = Object.entries(catalog.languages).map(([id,label]) => `<option value="`+escape(id)+'">'+escape(label)+`</option>`).join(''); (/** @type {HTMLInputElement} */ ($('language'))).value = settings.language; }
    for (const name of ['model','voice','tone','language','test-model']) if ($(name)) (/** @type {HTMLButtonElement} */ ($(name))).disabled = locked;
    if (preview) { (/** @type {HTMLButtonElement} */ ($('preview'))).disabled = locked && !previewActive; $('preview').textContent = previewActive ? t("ui.stopPreview") : t("ui.previewVoice"); $('preview').setAttribute('aria-pressed',String(previewActive)); }
    if ($('tips')) (/** @type {HTMLInputElement} */ ($('tips'))).checked = settings.showTips;
    if ($('selection-note')) $('selection-note').textContent = session?.phase === 'connected' ? model.id+' · '+t(session.audioVerified ? 'ui.voiceReceived' : 'voice.connectedAwaitingAudio') : model.id+' · '+status(model.check)+(model.check?.at ? ' · '+new Date(model.check.at).toLocaleString(languageTag()) : t("ui.youCanTestTheConnectionFirst"))+(model.check?.status === 'failed' && model.check.message ? ' · '+errorText(model.check.message) : '');
    if ($('models')) $('models').innerHTML = `<table class="voice-model-table"><thead><tr><th>${t("ui.model")}</th><th>${t("ui.validationResult")}</th></tr></thead><tbody>`+catalog.models.map(m => `<tr><td>`+escape(m.id)+`<small>`+(m.source === 'codex' ? t("ui.nativeCodex") : t("ui.officialAPICandidates"))+`</small></td><td>`+status(m.check)+(m.check?.message ? `<p>`+escape(errorText(m.check.message))+`</p>` : '')+`</td></tr>`).join('')+`</tbody></table>`;
  }
  async function load() {
    const current = ++loadRevision;
    try { const result = await api('/api/voice/options'); if (!alive || current !== loadRevision) return; catalog = result; update(); }
    catch (error) { if (!alive || current !== loadRevision) return; if ($('selection-note')) $('selection-note').textContent = error.message; onError(error); }
  }
  function bind() {
    const changed = () => {
      const before = {...settings};
      settings = {...settings,model:(/** @type {HTMLInputElement} */ ($('model'))).value,voice:(/** @type {HTMLInputElement} */ ($('voice'))).value,tone:(/** @type {HTMLInputElement} */ ($('tone'))).value,...(language ? {language:(/** @type {HTMLInputElement} */ ($('language'))).value} : {}),showTips:(/** @type {HTMLInputElement} */ ($('tips')))?.checked ?? settings.showTips}; update();
      const selected = {...settings}, current = ++revision;
      changes = changes.then(async () => {
        if (!alive) return;
        try { const saved = await onChange(selected); if (saved && alive && current === revision) { settings = saved; update(); } }
        catch (error) { if (alive && current === revision) { settings = before; update(); onError(error); } }
      });
    };
    for (const name of ['model','voice','tone','language','tips']) if ($(name)) $(name).onchange = () => { void changed(); };
    if ($('test-model')) $('test-model').onclick = () => { void changes.then(() => onTest({...settings})).catch(onError); };
    if (preview) $('preview').onclick = () => { void (previewActive ? Promise.resolve(onPreview({...settings})) : changes.then(() => onPreview({...settings}))).catch(onError); };
    return load();
  }
  return { render,bind,load,flush:() => changes,read:() => ({...settings}),lock(value) { if (locked !== value) { locked = value; update(); } },setSession(value) { if (session?.phase !== value.phase || session?.audioVerified !== value.audioVerified) { session = {phase:value.phase,audioVerified:value.audioVerified}; update(); } },setPreview(active,message) { previewActive = active; if (message && $('preview-note')) $('preview-note').textContent = message; update(); },ready:() => !!catalog,dispose() { alive = false; } };
}
