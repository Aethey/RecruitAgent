import { t, catalogText } from './i18n.js';
import { INTERVIEW_TOPICS } from '../src/features/interview/domain.ts';

/** Interface headings always use resources; stored generated titles remain untouched. */
/** @param {Pick<import('../src/features/interview/domain.ts').InterviewSet, 'type' | 'topic' | 'title' | 'language'>} set */
export function interviewTitle(set) {
  if (set.type === 'common' && set.topic === 'all') return t("ui.comprehensivePracticeExperienceCollaborationAndGrowth");
  const type = {common:t("ui.generalInterview"),technical:t("ui.technicalInterview"),position:t("ui.jobSpecificInterview")}[set.type];
  const topic = catalogText(INTERVIEW_TOPICS[set.type][set.topic]);
  return `${type} · ${topic}`;
}
