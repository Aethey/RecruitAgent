import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function assertNodeVersion(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 19) throw new Error(`需要 Node.js 22.19.0 或更新版本；当前为 ${version}。`);
}
export function loadConfig() {
  assertNodeVersion();
  try { loadEnvFile(resolve(root, '.env')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取项目 .env 配置。', { cause: error }); }
}
export function serverPort(value = process.env.PORT ?? '3000') {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('PORT 必须是 1–65535 的整数。');
  return Number(value);
}
export function openBrowser(url) {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => console.log(`请在浏览器打开 ${url}`)); child.unref();
}
