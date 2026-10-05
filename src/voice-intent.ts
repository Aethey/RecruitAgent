export type VoiceIntent = "answer" | "sample" | "clarification" | "continue" | "answer-complete" | "next" | "retry" | "finish" | "stop" | "pause" | "resume";

// Commands must occupy the entire utterance. Do not turn a quoted example,
// negation, or a sentence that happens to contain a command into an action.
export function classifyVoiceIntent(value: string): VoiceIntent {
  const raw = value.trim().toLowerCase();
  if (!raw || raw.length > 180 || /["“”「」『』]/u.test(raw)) return "answer";
  const phrase = raw.replace(/[\p{P}\p{S}\s]/gu, "");
  const commands: [VoiceIntent, RegExp][] = [
    ["next", /^(?:(?:好|好的|可以)?(?:请)?(?:下一题|下一个问题|进入下一题|继续下一题)(?:吧|好吗|谢谢)?|(?:次の質問|次の問題|次の問い)(?:へ|に進んで)?(?:ください|お願いします)?|次に進んで(?:ください)?|(?:please)?(?:nextquestion|nextone|gotothenextquestion|moveontothenextquestion)(?:please|thanks)?)$/u],
    ["retry", /^(?:(?:请)?(?:重答|重新回答|再答一次|重来|这题重来|重答这题|重新回答这题)(?:吧|好吗|谢谢)?|(?:もう一度答えます|もう一度回答します|答え直します|回答し直します|この質問をやり直します)|(?:please)?(?:retry|tryagain|letmetryagain|letmeanswerthequestionagain|restartthisquestion)(?:please)?)$/u],
    ["finish", /^(?:(?:请)?(?:完成|完成面试|完成本次面试|结束面试|结束本次面试)(?:吧|谢谢)?|(?:面接を終了|面接を終わり|面接を終え)(?:します|にします|てください)|(?:please)?(?:finish|finishtheinterview|endtheinterview|wecanfinishtheinterview)(?:please)?)$/u],
    ["continue", /^(?:(?:等一下|稍等|等等)?(?:我(?:还)?没说完|我还没回答完|我还要补充|我再补充一点|我想继续说|让我想一下|我想一下|我再想一想|等我想一下|请先听我说完)(?:呢|啊|吧)?|(?:ちょっと)?(?:まだ話し終わっていません|まだ答え終わっていません|まだ話している途中です|まだ続きがあります|少し考えさせてください|少し考えたいです|考える時間をください|ちょっと待ってください)|(?:please)?(?:imnotdone(?:yet)?|imnotfinished(?:yet)?|ihaventfinished(?:yet)?|letmefinish|letmethink(?:foramoment)?|givemeamomenttothink|holdon(?:amoment)?)(?:please)?)$/u],
    ["answer-complete", /^(?:(?:我)?(?:说完了|讲完了|回答完了|这就是我的回答|以上就是我的回答)|(?:以上です|回答は以上です|これで回答を終わります|話し終わりました)|(?:thatsall|thatsmyanswer|imdonewithmyanswer|ivefinishedmyanswer))$/u],
    ["stop", /^(?:(?:请)?(?:停止|停一下|停止回复|停止本轮回复|别说了|先别说话)(?:吧)?|(?:ストップ|やめて|止めて|話すのをやめて)(?:ください)?|(?:please)?(?:stop|stopspeaking|stoptalking|stopthisresponse)(?:please)?)$/u],
    ["pause", /^(?:(?:请)?(?:暂停|暂停对话|暂停一下)(?:吧)?|(?:一時停止|一旦止めて|会話を一時停止)(?:してください|ください)?|(?:please)?(?:pause|pausetheconversation|pauseforamoment)(?:please)?)$/u],
    ["resume", /^(?:(?:请)?(?:继续对话|恢复对话|可以继续了)(?:吧)?|(?:会話を再開|再開)(?:してください|します)?|(?:please)?(?:resume|resumetheconversation|wecancontinue)(?:please)?)$/u],
    ["sample", /^(?:(?:请|能|能否|可以|能不能|麻烦)?(?:你)?(?:给我|提供|说|讲|展示)?(?:一(?:个|段))?(?:例文|示范|示范回答|示例回答|回答范例|例句)(?:看看|听听|一下|吗|好吗|吧|谢谢)?|(?:请|可以)?(?:用这些事实|只用这些事实|基于这些事实)(?:给我)?(?:一(?:个|段))?(?:例文|示范|例句)(?:吗|吧)?|(?:怎么回答|如何回答|怎么说|如何措辞)(?:这题|这个问题)?(?:更自然|比较好)?|(?:この事実だけを使って)?(?:例文|回答例|例|お手本)(?:を)?(?:教えて|見せて|示して)(?:ください|くれますか|もらえますか)|(?:どう答えればいいですか|どう言えばいいですか)|(?:please|canyou|couldyou)?(?:giveme|showme)(?:an?|one)?(?:example|sampleanswer|exampleanswer)(?:please)?|(?:howshouldianswer|howcaniphrasethat))$/u],
    ["clarification", /^(?:(?:请|能|能否|可以|能不能)?(?:你)?(?:再说一遍|重复问题|重复一下问题|解释一下问题|解释这道题|解释一下这道题|再解释一下|具体是什么意思|这是什么意思|这题是什么意思|追问我|问我一个追问|给我一个追问)(?:吗|好吗|吧|谢谢)?|(?:もう一度質問を言って|質問を繰り返して|質問を説明して|もう少し説明して|追加の質問をして)(?:ください|もらえますか)|どういう意味ですか|(?:please|canyou|couldyou)?(?:repeatthequestion|saythequestionagain|explain(?:thequestion|that)|whatdoyoumean|askmeafollowup(?:question)?)(?:please)?)$/u],
  ];
  for (const [intent, pattern] of commands) if (pattern.test(phrase)) return intent;
  return "answer";
}

export function hasAnswerContent(value: string) {
  const phrase = value.replace(/[\p{P}\p{S}\s]/gu, "").toLowerCase();
  return !!phrase && !/^(?:(?:嗯|呃|额|啊|哦|好|好的|对|是|谢谢|はい|ええ|えっと|あの|うん|そうですね|ありがとうございます|yes|yeah|ok|okay|uh|um|hmm|thanks|thankyou))+$/u.test(phrase);
}
