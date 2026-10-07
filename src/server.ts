import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, openBrowser, serverPort } from "../scripts/runtime.mjs";
import { createApp } from "./app/http.ts";

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  loadConfig();
  const port = serverPort();
  const app = await createApp();
  app.server.listen(port, "127.0.0.1", () => {
    console.log(
      `\n  Algo Practice → http://localhost:${port}\n  首次使用：点击网页右上角「连接 Codex」完成 OAuth。\n`,
    );
    if (process.env.OPEN_BROWSER === "1")
      openBrowser(`http://localhost:${port}`);
  });
  app.server.on("error", (error) => {
    console.error(
      error instanceof Error && "code" in error && error.code === "EADDRINUSE"
        ? `端口 ${port} 已被占用，可用 PORT=3001 npm start。`
        : "服务器启动失败。",
    );
    process.exitCode = 1;
  });
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      void app
        .close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
}
