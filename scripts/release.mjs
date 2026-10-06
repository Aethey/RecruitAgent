import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { root } from './runtime.mjs';

// Only application code, synthetic fixtures and public documentation enter a release.
const entries = ['src', 'scripts', 'test', 'public', 'examples', '.github', 'docs/release-checklist.md', 'docs/code-generation.md', 'docs/images/interview-practice.jpg', 'docs/images/algorithm-practice.jpg', 'docs/images/technical-breadth.jpg', 'docs/images/knowledge-cards.jpg', 'docs/images/voice-interview.png', 'README.md', 'README.en.md', 'README.zh-CN.md', 'LICENSE', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.web.json', '.gitignore', '.env.example', 'start.command', 'start.sh', 'start.cmd'];
const files = [];
async function visit(path) {
  const name = relative(root, path).split(sep).join('/');
  if (name === 'public/assets' || name === 'scripts/.DS_Store') return;
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`发布文件不允许符号链接：${name}`);
  if (info.isDirectory()) {
    for (const child of (await readdir(path)).sort()) await visit(join(path, child));
  } else {
    if (name.endsWith('.DS_Store') || name.includes('.local.')) return;
    if (name.startsWith('src/') && !/\.(ts|mjs|mts|json)$/.test(name)) return;
    if (name.startsWith('test/') && !name.endsWith('.ts')) return;
    if (name.startsWith('scripts/') && !/\.(mjs|mts|ts)$/.test(name)) return;
    if (name.startsWith('public/') && !/\.(js|ts|css|json|html)$/.test(name) && !['public/voice-test-1.wav', 'public/voice-test-2.wav', 'public/interview-test.wav'].includes(name)) return;
    const data = await readFile(path);
    if (!name.endsWith('.wav') && /\/Users\/rya\b|\u5289\u91ce|\u5218\u91ce|\bsk-[A-Za-z0-9_-]{20,}|\b(?:access_token|refresh_token)\s*["']?\s*:\s*["'][A-Za-z0-9._-]{20,}/.test(data.toString('utf8'))) throw new Error(`发布检查发现个人信息或凭据特征：${name}`);
    files.push({ path: name, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length });
  }
}
try {
  for (const entry of entries) await visit(resolve(root, entry));
  if (process.argv.includes('--check')) console.log(`发布内容检查通过：${files.length} 个文件；不包含用户资料、凭据、未审核截图、运行日志或依赖目录。`);
  else {
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    const output = resolve(root, 'release', `RecruitAgent-${pkg.version}-${Date.now()}`);
    await mkdir(output, { recursive: true });
    for (const file of files) {
      const target = resolve(output, file.path); await mkdir(dirname(target), { recursive: true });
      await cp(resolve(root, file.path), target);
    }
    await writeFile(resolve(output, 'release-manifest.json'), JSON.stringify({ version: pkg.version, files }, null, 2));
    console.log(`可公开的项目目录：${output}\n${files.length} 个文件，内容校验已通过。上传此目录，或在原项目中依照 docs/release-checklist.md 检查待提交文件。`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
