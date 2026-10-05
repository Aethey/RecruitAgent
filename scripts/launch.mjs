import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNodeVersion, loadConfig, root, serverPort } from './runtime.mjs';

function npm(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', () => reject(new Error('未找到 npm，请安装包含 npm 的 Node.js。')));
    child.on('exit', code => code === 0 ? resolveRun() : reject(new Error('依赖安装或构建失败，请检查上方错误并重新启动。')));
  });
}
async function checkPort(port) {
  const server = createServer();
  await new Promise((resolveCheck, reject) => {
    server.once('error', error => reject(new Error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请关闭已有实例，或在 .env 中设置其他 PORT。` : '无法监听本机端口。', { cause: error })));
    server.listen(port, '127.0.0.1', () => server.close(resolveCheck));
  });
}
try {
  assertNodeVersion(); loadConfig();
  const port = serverPort();
  const dependencies = ['tsx', 'esbuild', '@earendil-works/pi-coding-agent', 'pdfjs-dist', 'monaco-editor', 'cheerio', 'marked', 'dompurify', '@napi-rs/canvas', '@openai/codex', 'ajv', 'openapi-typescript', 'prettier', 'typescript', 'typescript-json-schema'];
  if (process.argv.includes('--check')) {
    const missing = dependencies.filter(name => !existsSync(resolve(root, 'node_modules', name, 'package.json')));
    console.log(`Node.js ${process.versions.node} · ${process.platform}/${process.arch}`);
    console.log(missing.length ? `缺少依赖：${missing.join(', ')}。运行启动脚本会自动安装。` : '项目依赖已安装。');
    console.log(`数据目录：${resolve(root, process.env.DATA_DIR ?? 'data')}`);
    console.log(`本机地址：http://localhost:${port}`);
  } else {
    await checkPort(port);
    if (dependencies.some(name => !existsSync(resolve(root, 'node_modules', name, 'package.json')))) await npm(['ci', '--ignore-scripts']);
    await npm(['run', 'build']);
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: root, stdio: 'inherit', env: { ...process.env, OPEN_BROWSER: process.env.OPEN_BROWSER ?? '1' } });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('error', () => { console.error('无法启动本机服务。'); process.exitCode = 1; });
    await new Promise(resolveRun => child.on('exit', code => { process.exitCode = code ?? 0; resolveRun(); }));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
