export const LANGUAGES = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  java: "Java",
  kotlin: "Kotlin",
  dart: "Dart",
  swift: "Swift",
  go: "Go",
} as const;
export type Language = keyof typeof LANGUAGES;
