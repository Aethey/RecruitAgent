import { t, ui } from "./i18n.js";
import * as monaco from "monaco-editor";

// Both workers run in the browser and load entirely from this application's origin.
self.MonacoEnvironment = {
  getWorker(_id, label) {
    const file = label === "typescript" || label === "javascript" ? "ts.worker.js" : "editor.worker.js";
    return new Worker(`/assets/${file}`, { type: "module", name: `monaco-${label}` });
  },
};
function syncEditorTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const style = getComputedStyle(document.documentElement);
  const color = name => style.getPropertyValue('--' + name).trim();
  monaco.editor.defineTheme('algo-practice', {
    base: dark ? 'vs-dark' : 'vs', inherit: true,
    rules: [
      { token: 'comment', foreground: color('code-comment').slice(1), fontStyle: 'italic' },
      { token: 'keyword', foreground: color('code-keyword').slice(1) },
      { token: 'string', foreground: color('code-string').slice(1) },
      { token: 'number', foreground: color('code-number').slice(1) },
    ],
    colors: {
      'editor.background': color('editor-bg'), 'editor.foreground': color('editor-ink'),
      'editorLineNumber.foreground': color('muted'), 'editorLineNumber.activeForeground': color('blue'),
      'editor.lineHighlightBackground': color('bg'), 'editor.selectionBackground': color('selection'),
      'editor.inactiveSelectionBackground': color('surface-alt'), 'editorCursor.foreground': color('blue'),
      'editorIndentGuide.background1': color('line'), 'editorIndentGuide.activeBackground1': color('outline'),
      'editorBracketMatch.background': color('mint'), 'editorBracketMatch.border': color('success'),
    },
  });
  monaco.editor.setTheme('algo-practice');
}
syncEditorTheme();
window.addEventListener('app-theme-change', syncEditorTheme);

let editor = null, model = null, problemId = null, viewState = null, subscription = null;
const compactScreen = window.matchMedia("(max-width: 700px)");
compactScreen.addEventListener("change", () => editor?.updateOptions({ fontSize: compactScreen.matches ? 16 : 14 }));

export function editorValue() { return model?.getValue() ?? ""; }
export function hasEditor() { return editor !== null; }
export function editorSelection() { return editor && model ? model.getValueInRange(editor.getSelection()) : ""; }

export function unmountEditor(nextId = null) {
  if (editor) viewState = editor.saveViewState();
  subscription?.dispose(); subscription = null;
  editor?.dispose(); editor = null;
  // Retain the live model, undo stack and cursor when feedback causes a re-render.
  if (nextId !== problemId) {
    model?.dispose(); model = null; problemId = null; viewState = null;
  }
}

export function mountEditor(container, { id, filename, language, value, onChange }) {
  if (!model) {
    model = monaco.editor.createModel(value, language, monaco.Uri.parse(`inmemory://practice/${id}/${filename}`));
    model.updateOptions({ tabSize: language === "python" ? 4 : 2, insertSpaces: true });
    problemId = id;
  }
  editor = monaco.editor.create(container, {
    model,
    theme: "algo-practice",
    ariaLabel: t("解题代码"),
    automaticLayout: true,
    autoIndent: "full",
    matchBrackets: "always",
    autoClosingBrackets: "languageDefined",
    autoClosingQuotes: "languageDefined",
    bracketPairColorization: { enabled: true },
    minimap: { enabled: false },
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: compactScreen.matches ? 16 : 14,
    lineHeight: 25,
    lineNumbersMinChars: 3,
    padding: { top: 16, bottom: 16 },
    scrollBeyondLastLine: false,
    wordWrap: "on",
    wrappingIndent: "same",
    renderLineHighlight: "line",
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    stickyScroll: { enabled: false },
    fixedOverflowWidgets: true,
    tabIndex: 0,
  });
  if (viewState) editor.restoreViewState(viewState);
  subscription = editor.onDidChangeModelContent(onChange);
}

export function mountReference(container, { language, value }) {
  const referenceModel = monaco.editor.createModel(value, language);
  const reference = monaco.editor.create(container, {
    model: referenceModel, theme: "algo-practice", readOnly: true, domReadOnly: true,
    ariaLabel: t("正确模板"), automaticLayout: true, minimap: { enabled: false },
    fontFamily: "Menlo, Monaco, Consolas, monospace", fontSize: compactScreen.matches ? 16 : 14,
    lineHeight: 25, lineNumbersMinChars: 3, wordWrap: "on", scrollBeyondLastLine: false,
    padding: { top: 16, bottom: 16 }, stickyScroll: { enabled: false },
    overviewRulerLanes: 0, bracketPairColorization: { enabled: true },
  });
  const resize = () => reference.updateOptions({ fontSize: compactScreen.matches ? 16 : 14 });
  compactScreen.addEventListener("change", resize);
  return () => { compactScreen.removeEventListener("change", resize); reference.dispose(); referenceModel.dispose(); };
}
