import { t, message, catalogText, errorText } from './i18n.js';

const stages = {waiting:t("ui.readyToStart"),asking:t("ui.codexIsAskingAQuestion"),answering:t("ui.listeningToYourAnswer"),feedback:t("ui.codexIsGivingFeedback"),assisting:t("ui.codexIsRespondingToYourRequest"),ready:t("ui.youCanAnswerAgainOrMoveToThe"),ended:t("ui.thisInterviewHasEnded")};

export function voiceActivity(state, mode = 'interview', stage = 'waiting', preparing = false) {
  const level = Math.max(state.inputLevel ?? 0,state.outputLevel ?? 0);
  const capturing = !!state.recording && !state.test && mode !== 'preview' && mode !== 'probe';
  const result = (activity,label,detail,recording = false,animate = false) => ({activity,label,detail:errorText(detail),recording,animate,level});
  if (preparing) return result('preparing',t("ui.preparingQuestions"),t("ui.preparingQuestionsAndTipsForTheSelectedLanguage"),false,true);
  if (state.error) return result('error',t("ui.connectionIncomplete"),state.error);
  if (state.phase === 'connecting') return result('connecting',t("ui.connecting"),mode === 'preview' ? t("ui.connectTheSelectedVoiceNoMicrophoneIsNeeded") : t("ui.afterConnectingCodexWillAskTheFirstQuestion"),false,true);
  if (state.phase === 'ending') return result('ended',mode === 'preview' ? t("ui.endingTrialSession") : t("ui.endingCall"),t("ui.microphoneIsOff"));
  if (state.phase !== 'connected') return result('idle',state.phase === 'ended' ? t("ui.callEnded") : t("ui.waitingToStart"),t("ui.microphoneIsNotEnabled"));
  if (state.paused) return result(state.stopped ? 'stopped' : 'paused',state.controlBusy ? state.resuming ? t("ui.resumingListening") : t("ui.pausingTheConversation") : state.stopped ? t("ui.thisRoundHasStopped") : t("ui.conversationPaused"),state.notice || (state.resuming ? t("ui.thisResponseHasBeenStoppedListeningWillResume") : t("ui.recordingAndPlaybackHaveStoppedTapContinueConversation")),false,state.controlBusy);
  if (state.notice) return result('warning',t("ui.processingIncomplete"),state.notice,capturing,capturing);
  if (mode === 'preview') return result('preview',t("ui.voicePreview"),t("ui.playingTheSelectedVoiceMicrophoneIsOff"),false,state.outputSpeaking);
  if (state.outputSpeaking) return result('speaking',t("ui.codexIsSpeaking"),state.backendThinking || state.delegating ? t("ui.stillProcessingInTheBackgroundYouCanStop") : t("ui.youCanStopThisResponseOrPauseThe"),capturing,true);
  if (state.processing || state.backendThinking || state.delegating) {
    const elapsed = state.processingElapsed ?? 0, waiting = elapsed >= 15;
    return result(waiting ? 'slow' : state.backendThinking ? 'thinking' : 'processing',waiting ? t("ui.longWait") : state.backendThinking ? t("ui.codexIsThinkingInTheBackground") : state.delegating ? t("ui.waitingForBackendResult") : t("ui.processingVoice"),
      message(state.backendThinking ? 'voice.thinking' : 'voice.processing', {seconds:elapsed,action:t(waiting ? "ui.youCanStopThisResponseOnTimeoutThe" : "ui.youCanStopOrPauseAtAnyTime")}),capturing,true);
  }
  if (mode === 'probe' || state.test) return result('test',t("ui.speechSynthesisTest"),t("ui.microphoneNotUsed"),false,state.outputSpeaking);
  if (state.muted || !state.recording) return {...result('muted',t("ui.microphoneIsMuted"),state.outputSpeaking ? t("ui.codexIsSpeaking2") : t("ui.turnOnTheMicrophoneThenContinueAnswering")),level:0};
  return result('recording',t("ui.recording"),mode === 'demo' ? t("ui.speakDirectlyThenWaitForCodexToAnswer") : stages[stage] ?? stages.answering,true,true);
}
