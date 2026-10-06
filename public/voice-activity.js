import { t, message } from './i18n.js';

const stages = {waiting:'准备开始',asking:'Codex 正在提问',answering:'正在听你回答',feedback:'Codex 正在点评',assisting:'Codex 正在回应你的请求',ready:'可以重答或进入下一题',ended:'本次面试已结束'};

export function voiceActivity(state, mode = 'interview', stage = 'waiting', preparing = false) {
  const level = Math.max(state.inputLevel ?? 0,state.outputLevel ?? 0);
  const capturing = !!state.recording && !state.test && mode !== 'preview' && mode !== 'probe';
  const result = (activity,label,detail,recording = false,animate = false) => ({activity,label:t(label),detail:t(detail),recording,animate,level});
  if (preparing) return result('preparing','准备题目中','正在准备所选语言的提问和 tips…',false,true);
  if (state.error) return result('error','连接未完成',state.error);
  if (state.phase === 'connecting') return result('connecting','正在连接',mode === 'preview' ? '连接所选音色，无需麦克风。' : '连接后，Codex 会先提问。',false,true);
  if (state.phase === 'ending') return result('ended',mode === 'preview' ? '结束试听中' : '结束通话中','麦克风已关闭。');
  if (state.phase !== 'connected') return result('idle',state.phase === 'ended' ? '通话已结束' : '等待开始','麦克风未开启。');
  if (state.paused) return result(state.stopped ? 'stopped' : 'paused',state.controlBusy ? state.resuming ? '正在恢复倾听' : '正在暂停对话' : state.stopped ? '本轮已停止' : '对话已暂停',state.notice || (state.resuming ? '本轮回复已停止，旧音频清除后自动继续听你说话。' : '录音和播放已停止。点击继续对话，重新开口。'),false,state.controlBusy);
  if (state.notice) return result('error','处理未完成',state.notice);
  if (mode === 'preview') return result('preview','音色试听','正在播放所选音色 · 麦克风未开启',false,state.outputSpeaking);
  if (state.outputSpeaking) return result('speaking','Codex 正在说话',state.backendThinking || state.delegating ? '后台仍在处理，可随时停止本轮回复。' : '可随时停止本轮回复或暂停对话。',capturing,true);
  if (state.processing || state.backendThinking || state.delegating) {
    const elapsed = state.processingElapsed ?? 0, waiting = elapsed >= 15;
    return result(waiting ? 'slow' : state.backendThinking ? 'thinking' : 'processing',waiting ? '等待较久' : state.backendThinking ? 'Codex 后台思考中' : state.delegating ? '等待后台结果' : '语音处理中',
      message(state.backendThinking ? 'voice.thinking' : 'voice.processing', {seconds:elapsed,action:t(waiting ? '可以停止本轮回复；超时会停止旧回复并恢复倾听。' : '可以随时停止或暂停。')}),capturing,true);
  }
  if (mode === 'probe' || state.test) return result('test','合成语音测试','没有使用麦克风。',false,state.outputSpeaking);
  if (state.muted || !state.recording) return {...result('muted','麦克风已静音',state.outputSpeaking ? 'Codex 正在说话。' : '打开麦克风后继续回答。'),level:0};
  return result('recording','录音中',mode === 'demo' ? '直接说话，停顿后等待 Codex 回答。' : stages[stage] ?? stages.answering,true,true);
}
