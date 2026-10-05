import test from 'node:test';
import assert from 'node:assert/strict';
// The labels must follow microphone capture, not transcripts or a running timer.
// @ts-ignore Browser module has no TypeScript declarations.
import { voiceActivity } from '../public/voice-activity.js';

test('recording animation follows a connected live microphone and stops when muted, ended or failed',() => {
  const live = {phase:'connected',recording:true,muted:false,test:false,inputLevel:.4,outputLevel:0,outputSpeaking:false};
  for (const stage of ['asking','answering','feedback','assisting','ready']) {
    const activity = voiceActivity(live,'interview',stage); assert.equal(activity.label,'录音中'); assert.equal(activity.recording,true); assert.equal(activity.animate,true);
  }
  for (const state of [{...live,muted:true,recording:false},{...live,phase:'ended',recording:false},{...live,phase:'ending',recording:false},{...live,phase:'error',recording:false,error:'连接失败'}]) {
    const activity = voiceActivity(state); assert.equal(activity.recording,false); assert.equal(activity.animate,false); assert.notEqual(activity.label,'录音中');
  }
});

test('auditions, synthetic tests and connection setup do not claim microphone recording',() => {
  const connected = {phase:'connected',recording:true,test:false,outputSpeaking:false};
  const preview = voiceActivity(connected,'preview'); assert.equal(preview.label,'音色试听'); assert.equal(preview.recording,false);
  for (const state of [{...connected,test:true},{phase:'connecting'},{phase:'idle'}]) assert.equal(voiceActivity(state).recording,false);
  const muted = voiceActivity({...connected,muted:true,recording:false,outputLevel:.5});
  assert.equal(muted.label,'麦克风已静音'); assert.equal(muted.animate,false); assert.equal(muted.level,0);
});

test('processing, thinking, speech, slow responses and pause are distinct from microphone recording',() => {
  const live = {phase:'connected',recording:true,test:false};
  assert.equal(voiceActivity({...live,processing:true,processingElapsed:3}).label,'语音处理中');
  assert.equal(voiceActivity({...live,backendThinking:true}).label,'Codex 后台思考中');
  assert.equal(voiceActivity({...live,processing:true,processingElapsed:16}).label,'等待较久');
  assert.equal(voiceActivity({...live,outputSpeaking:true}).label,'Codex 正在说话');
  const paused = voiceActivity({...live,paused:true,recording:false}); assert.equal(paused.label,'对话已暂停'); assert.equal(paused.recording,false); assert.equal(paused.animate,false);
  assert.equal(voiceActivity({...live,paused:true,stopped:true}).label,'本轮已停止');
  assert.equal(voiceActivity({...live,test:true,processing:true}).recording,false);
  assert.equal(voiceActivity({...live,test:true,recording:false,processing:true}).recording,false);
});

test('automatic recovery and a deliberate pause have distinct labels and actionable details',() => {
  const live={phase:'connected',recording:false,test:false,paused:true,controlBusy:true};
  const recovering=voiceActivity({...live,stopped:true,resuming:true});
  assert.equal(recovering.label,'正在恢复倾听'); assert.match(recovering.detail,/自动继续听/); assert.equal(recovering.recording,false);
  const pausing=voiceActivity({...live,stopped:false,resuming:false});
  assert.equal(pausing.label,'正在暂停对话'); assert.doesNotMatch(pausing.detail,/自动/);
  const helping=voiceActivity({phase:'connected',recording:true},'interview','assisting');
  assert.equal(helping.detail,'Codex 正在回应你的请求');
});
