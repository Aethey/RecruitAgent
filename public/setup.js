import { element, elements } from './dom.ts';
import { t } from './i18n.js';

/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createSetup({ api, escape, getAccount }) {
  function markup() {
    return `<section class="card flat model-settings" id="setup-panel"><h2>${t("ui.gettingStarted")}</h2>
      <p class="card-subtitle">${t("ui.textAndVoiceConnectSeparatelyStudyRecordsAnd")}</p>
      <div class="setup-steps">
        <div><h3>${t("ui.connectTextFeatures")}</h3><p id="setup-text-status">${escape(getAccount().authenticated ? t("ui.textFeaturesAreConnected") : t("ui.clickConnectCodexAtTheTopRightAnd"))}</p></div>
        <div><h3>${t("ui.prepareInterviewDocuments")}</h3><p id="setup-material-status">${t("ui.checkingDocuments")}</p><a class="button flat small" href="#library">${t("ui.uploadDocuments")}</a> <a class="button flat small" href="#interview">${t("ui.selectInterviewDocuments")}</a></div>
        <div><h3>${t("ui.checkVoiceFeaturesOptional")}</h3><p>${t("ui.voiceRequiresASeparateCodexCLIInstallationIn")} <code>codex login</code>${t("ui.theAuthorizationAtTheTopIsForText")}</p><p id="setup-voice-status" role="status">${t("ui.notCheckedYetAlgorithmPracticeStudyAndChat")}</p><button class="button flat small" type="button" id="setup-check-voice">${t("ui.checkVoiceConnection")}</button></div>
      </div><p class="form-note">${t("ui.initialAuthorizationNeedsAnInternetConnectionImageRecognition")}</p>
      <a class="button primary" href="#practice">${t("ui.startAlgorithmPractice")}</a></section>
      <section class="card flat model-settings"><h2>${t("ui.dataBackup")}</h2><p>${t("ui.backupsIncludeStudyRecordsAndOriginalDocumentsExcluding")}</p><a class="button flat" href="/api/backup" download>${t("ui.downloadStudyBackup")}</a><p class="form-note">${t("ui.restoreToANewDataDirectoryThenStart")}</p></section>`;
  }
  async function bind() {
    const panel = element('#setup-panel');
    try {
      const sources = await api('/api/interview-sources');
      if (!panel?.isConnected) return;
      element('#setup-material-status', panel).textContent = sources.available ? t("ui.yourResumeIsReadyForInterviewQuestions") : t("ui.uploadYourOwnResumeThenSelectItIn");
    } catch (error) { if (panel?.isConnected) element('#setup-material-status', panel).textContent = error.message; }
    if (!panel?.isConnected) return;
    element('#setup-check-voice', panel).onclick = async event => {
      const button = event.currentTarget, status = element('#setup-voice-status', panel); (/** @type {HTMLButtonElement} */ (button)).disabled = true;
      status.textContent = t("ui.checkingVoiceConnection");
      try {
        const voice = await api('/api/voice/status');
        status.textContent = voice.authenticated ? t("ui.codexCLIIsSignedInTryTheVoice") : t("ui.codexCLIIsNotSignedInRunCodex");
      } catch (error) { status.textContent = error.message + t("setup.textFeaturesRemainAvailableInstallAndSignIn"); }
      finally { if ((/** @type {Node} */ (button)).isConnected) (/** @type {HTMLButtonElement} */ (button)).disabled = false; }
    };
  }
  return { markup, bind };
}
