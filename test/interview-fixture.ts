import type { InterviewSet } from '../src/interview.ts';

export const interviewFixture: InterviewSet = {
  id:'voice-interview-fixture',type:'technical',topic:'architecture',count:3,title:'支付状态重构 · 语音面试',introduction:'隔离测试问题',language:'zh',createdAt:'2026-10-04T00:00:00.000Z',updatedAt:'2026-10-04T00:00:00.000Z',
  questions:[
    {id:'q1',question:'请用一个具体例子说明，你在支付状态重构中做了什么？',kind:'technical',focus:'自己的关键行动与验证依据',tips:['先用一句话说明你做了什么。','选一个变化，说明本人行动和验证依据。'],keywords:['状态拆分','本人行动','验证边界'],answerBasis:'experience',evidenceNote:'隔离测试案例，不代表用户的真实经历。',sourceIds:['resume-test']},
    {id:'q2',question:'这次重构中你如何区分共通状态和个别状态？',kind:'technical',focus:'区分标准与取舍',tips:['先说区分标准。'],keywords:['共享时间尺度','局部生命周期','取舍验证'],answerBasis:'knowledge',evidenceNote:'隔离测试的通用机制问题。',sourceIds:['resume-test']},
    {id:'q3',question:'你会怎样验证旧请求不会覆盖新状态？',kind:'technical',focus:'验证条件与可观察结果',tips:['用一个可重现的场景说明验证方法。'],keywords:['请求标识','状态归属','边界验证'],answerBasis:'knowledge',evidenceNote:'隔离测试的通用验证问题。',sourceIds:['resume-test']},
  ], answers:{q1:'已有文字草稿'}, reviews:[], sources:[{id:'resume-test',title:'隔离测试案例',kind:'resume',content:'PRIVATE_RESUME_BODY：这是合成测试案例，状态重构未记录量化效果。'}],
};
