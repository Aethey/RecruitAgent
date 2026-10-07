import type { Locale } from "../i18n/locales.ts";
import type { LanguageDrill } from "../../features/language/domain.ts";
import type {
  InterviewJob,
  InterviewSet,
} from "../../features/interview/domain.ts";
import type { LibraryItem } from "../../features/library/service.ts";
import type {
  KnowledgePoint,
  Card,
  StudyBatch,
} from "../../features/study/service.ts";
import type { Training } from "../../features/training/domain.ts";
import type { ChatThread } from "../../features/chat/service.ts";
import type { Problem, Analysis } from "../../features/algorithm/domain.ts";
import type { TeacherSettings } from "../../features/chat/settings.ts";

export type InterviewMaterials = {
  resume: string[];
  personal: string[];
  study: string[];
};
export type State = {
  interviewMaterials?: InterviewMaterials;
  version: 1;
  problems: Problem[];
  languageDrills?: LanguageDrill[];
  interviewJobs?: InterviewJob[];
  interviews?: InterviewSet[];
  library?: LibraryItem[];
  trainings?: Training[];
  studyPoints?: KnowledgePoint[];
  studyCards?: Card[];
  studyBatches?: StudyBatch[];
  chats?: ChatThread[];
  analysis?: Analysis;
  settings?: {
    model: string;
    visibleModels?: string[];
    teacher?: TeacherSettings;
    uiLanguage?: Locale;
    userLanguage?: Locale;
  };
};
