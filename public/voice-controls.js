/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createVoiceControls({ api, escape, prefix, initial = {}, tips = false, language = false, preview = false, onChange = () => {}, onTest = () => {}, onPreview = () => {}, onError = () => {} }) {
  let settings = {model:'gpt-live-1-codex',voice:'cove',tone:'natural',showTips:true,...(language ? {language:'zh'} : {}),...initial}, catalog = null, alive = true, locked = false, previewActive = false;
  let changes = Promise.resolve(), revision = 0;
  const $ = name => document.getElementById(prefix+'-'+name);
  const status = check => check?.status === 'available' ? '已收到语音' : check?.status === 'failed' ? '连接失败' : '未验证';
  function render() {
    return '<section class="voice-settings card flat" id="'+prefix+'-settings"><div class="section-heading"><div><h2>语音设置</h2><p class="card-subtitle">开始通话前选择模型、音色和语气'+(language ? '，并选择面试语言' : '')+'。</p></div></div>'+
      '<div class="voice-settings-fields'+(language ? ' voice-settings-with-language' : '')+'"><div class="field"><label for="'+prefix+'-model">语音模型</label><select id="'+prefix+'-model" disabled><option>正在读取…</option></select></div>'+
      '<div class="field"><label for="'+prefix+'-voice">音色</label><select id="'+prefix+'-voice" disabled></select>'+(preview ? '<button type="button" class="button flat small voice-preview-button" id="'+prefix+'-preview" aria-pressed="false" disabled>▶ 试听音色</button>' : '')+'</div>'+
      '<div class="field"><label for="'+prefix+'-tone">语气</label><select id="'+prefix+'-tone" disabled></select></div>'+
      (language ? '<div class="field"><label for="'+prefix+'-language">面试语言</label><select id="'+prefix+'-language" disabled></select><small class="voice-language-note">提问、tips 和点评的语言</small></div>' : '')+'</div>'+
      (preview ? '<p id="'+prefix+'-preview-note" class="voice-note voice-preview-note" role="status">试听当前音色、语气和语言，无需打开麦克风。</p>' : '')+
      (tips ? '<label class="voice-tips-choice"><input id="'+prefix+'-tips" type="checkbox" '+(settings.showTips ? 'checked' : '')+'> 显示回答重点 tips</label><p class="voice-note">开启时显示当前题的一个或多个重点；保留为辅助训练记录。</p>' : '')+
      '<p id="'+prefix+'-selection-note" class="voice-note" role="status">正在查询本机 Codex…</p><button type="button" class="button flat small" id="'+prefix+'-test-model" disabled>检测所选语音模型</button>'+
      '<details class="voice-model-directory"><summary>查看语音模型与验证结果</summary><p class="voice-note">Codex 未提供实时模型的完整账号目录。这里列出原生默认、备用和官方 API 候选；是否可用按当前登录的实际连接结果显示。</p><div id="'+prefix+'-models"></div><a href="https://developers.openai.com/api/docs/models" target="_blank" rel="noreferrer">官方模型目录 ↗</a></details></section>';
  }
  function update() {
    if (!alive || !$('settings') || !catalog) return;
    const model = catalog.models.find(m => m.id === settings.model) ?? catalog.models[0]; settings.model = model.id;
    const voices = catalog.voices[model.group];
    if (!voices.includes(settings.voice)) settings.voice = model.group === 'v1' ? catalog.voices.defaultV1 : catalog.voices.defaultV2;
    $('model').innerHTML = catalog.models.map(m => '<option value="'+escape(m.id)+'">'+escape(m.label)+' · '+status(m.check)+'</option>').join(''); (/** @type {HTMLInputElement} */ ($('model'))).value = settings.model;
    $('voice').innerHTML = voices.map(voice => '<option value="'+escape(voice)+'">'+escape(voice[0].toUpperCase()+voice.slice(1))+'</option>').join(''); (/** @type {HTMLInputElement} */ ($('voice'))).value = settings.voice;
    $('tone').innerHTML = Object.entries(catalog.tones).map(([id,label]) => '<option value="'+escape(id)+'">'+escape(label)+'</option>').join(''); (/** @type {HTMLInputElement} */ ($('tone'))).value = settings.tone;
    if (language) { $('language').innerHTML = Object.entries(catalog.languages).map(([id,label]) => '<option value="'+escape(id)+'">'+escape(label)+'</option>').join(''); (/** @type {HTMLInputElement} */ ($('language'))).value = settings.language; }
    for (const name of ['model','voice','tone','language','test-model']) if ($(name)) (/** @type {HTMLButtonElement} */ ($(name))).disabled = locked;
    if (preview) { (/** @type {HTMLButtonElement} */ ($('preview'))).disabled = locked && !previewActive; $('preview').textContent = previewActive ? '■ 停止试听' : '▶ 试听音色'; $('preview').setAttribute('aria-pressed',String(previewActive)); }
    if ($('tips')) (/** @type {HTMLInputElement} */ ($('tips'))).checked = settings.showTips;
    $('selection-note').textContent = model.check?.status === 'failed' ? model.id+'：'+model.check.message : model.id+' · '+status(model.check)+(model.check?.at ? ' · '+new Date(model.check.at).toLocaleString() : '，可以先检测连接。');
    $('models').innerHTML = '<table class="voice-model-table"><thead><tr><th>模型</th><th>验证结果</th></tr></thead><tbody>'+catalog.models.map(m => '<tr><td>'+escape(m.id)+'<small>'+(m.source === 'codex' ? 'Codex 原生' : '官方 API 候选')+'</small></td><td>'+status(m.check)+(m.check?.message ? '<p>'+escape(m.check.message)+'</p>' : '')+'</td></tr>').join('')+'</tbody></table>';
  }
  async function load() {
    try { const result = await api('/api/voice/options'); if (!alive) return; catalog = result; update(); }
    catch (error) { if (alive && $('selection-note')) $('selection-note').textContent = error.message; onError(error); }
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
    $('test-model').onclick = () => { void changes.then(() => onTest({...settings})).catch(onError); };
    if (preview) $('preview').onclick = () => { void (previewActive ? Promise.resolve(onPreview({...settings})) : changes.then(() => onPreview({...settings}))).catch(onError); };
    return load();
  }
  return { render,bind,load,flush:() => changes,read:() => ({...settings}),lock(value) { if (locked !== value) { locked = value; update(); } },setPreview(active,message) { previewActive = active; if (message && $('preview-note')) $('preview-note').textContent = message; update(); },ready:() => !!catalog,dispose() { alive = false; } };
}
