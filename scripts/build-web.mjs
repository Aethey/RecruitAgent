import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "public/assets");
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: {
    app: "public/app.js",
    "editor.worker": "node_modules/monaco-editor/esm/vs/editor/editor.worker.js",
    "ts.worker": "node_modules/monaco-editor/esm/vs/languages/features/typescript/ts.worker.js",
    "pdf.worker": "node_modules/pdfjs-dist/build/pdf.worker.mjs",
  },
  outdir,
  bundle: true,
  format: "esm",
  splitting: true,
  target: "es2022",
  minify: true,
  loader: { ".ttf": "file" },
  assetNames: "[name]-[hash]",
  chunkNames: "chunk-[hash]",
  logLevel: "warning",
});
await build({ entryPoints: [resolve(root, "public/theme.js")], outfile: resolve(outdir, "theme-init.js"), bundle: true, format: "iife", target: "es2022", minify: true });
await cp(resolve(root, "node_modules/monaco-editor/LICENSE"), resolve(outdir, "monaco-LICENSE.txt"));
await cp(resolve(root, "node_modules/monaco-editor/ThirdPartyNotices.txt"), resolve(outdir, "monaco-ThirdPartyNotices.txt"));
for (const [source, name] of [
  ["pdfjs-dist/LICENSE", "pdfjs-LICENSE.txt"],
  ["marked/LICENSE", "marked-LICENSE.txt"],
  ["dompurify/LICENSE", "dompurify-LICENSE.txt"],
]) await cp(resolve(root, "node_modules", source), resolve(outdir, name));
console.log("前端编辑器资源已构建。");
