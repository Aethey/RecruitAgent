import { element, elements } from './dom.ts';
import { t, ui } from './i18n.js';

/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createSetup({ api, escape, getAccount }) {
  function markup() {
    return ui`<section class="card flat model-settings" id="setup-panel"><h2>开始使用</h2>
      <p class="card-subtitle">文字功能和语音功能分别连接；所有学习记录与上传资料保存在本机。</p>
      <div class="setup-steps">
        <div><h3>1. 连接文字功能</h3><p id="setup-text-status">${escape(getAccount().authenticated ? t('文字功能已连接。') : t('点击右上角「连接 Codex」，使用自己的账号完成授权。'))}</p></div>
        <div><h3>2. 准备面试资料</h3><p id="setup-material-status">正在检查资料…</p><a class="button flat small" href="#library">上传资料</a> <a class="button flat small" href="#interview">选择出题资料</a></div>
        <div><h3>3. 检查语音功能（可选）</h3><p>语音需要另外安装 Codex CLI，并在终端运行 <code>codex login</code>。顶部授权用于文字功能。</p><p id="setup-voice-status" role="status">尚未检查。语音不可用时，仍可使用算法、学习和聊天功能。</p><button class="button flat small" type="button" id="setup-check-voice">检查语音连接</button></div>
      </div><p class="form-note">首次使用需要联网完成账号授权。图片识别和 AI 练习会把相关资料发送给模型服务。</p>
      <a class="button primary" href="#practice">开始算法练习 →</a></section>
      <section class="card flat model-settings"><h2>数据备份</h2><p>备份包含学习记录和资料原文件，不包含登录凭据。备份中仍有你的个人资料，请保存在自己的设备上。</p><a class="button flat" href="/api/backup" download>下载学习数据备份</a><p class="form-note">恢复到新的数据目录后启动应用；具体步骤见 README 的备份与恢复说明。</p></section>`;
  }
  async function bind() {
    const panel = element('#setup-panel');
    try {
      const sources = await api('/api/interview-sources');
      if (!panel?.isConnected) return;
      element('#setup-material-status', panel).textContent = sources.available ? t('简历已就绪，可以生成面试问题。') : t('上传自己的简历，再在面试练习中选择出题资料。');
    } catch (error) { if (panel?.isConnected) element('#setup-material-status', panel).textContent = error.message; }
    if (!panel?.isConnected) return;
    element('#setup-check-voice', panel).onclick = async event => {
      const button = event.currentTarget, status = element('#setup-voice-status', panel); (/** @type {HTMLButtonElement} */ (button)).disabled = true;
      status.textContent = t('正在检查语音连接…');
      try {
        const voice = await api('/api/voice/status');
        status.textContent = voice.authenticated ? t('Codex CLI 已登录，可以打开语音 Demo 测试。语音接口为实验功能，实际可用性以连接结果为准。') : t('Codex CLI 尚未登录，请在终端运行 codex login 后重新检查。');
      } catch (error) { status.textContent = error.message + t(' 文字功能仍可使用；安装并登录 Codex CLI 后可以重新检查。'); }
      finally { if ((/** @type {Node} */ (button)).isConnected) (/** @type {HTMLButtonElement} */ (button)).disabled = false; }
    };
  }
  return { markup, bind };
}
