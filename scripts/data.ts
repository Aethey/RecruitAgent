import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { loadConfig, root } from './runtime.mjs';
import { Store } from '../src/shared/persistence/store.ts';
import { exportBackup, restoreBackup } from '../src/shared/persistence/backup.ts';

try {
  loadConfig();
  const [command, filename, flag, destination] = process.argv.slice(2);
  if (command === 'backup' && (!flag || flag === '--data-dir' && destination)) {
    const dataDir = resolve(root, destination ?? process.env.DATA_DIR ?? 'data');
    const store = new Store(resolve(dataDir, 'state.json')); await store.load();
    const output = resolve(filename ?? `backups/recruitagent-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`);
    const data = await exportBackup(store, dataDir);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, data, { mode: 0o600, flag: 'wx' });
    console.log(`备份已保存：${output}（不含登录凭据）`);
  } else if (command === 'restore' && filename && flag === '--data-dir' && destination) {
    const target = resolve(root, destination);
    await restoreBackup(await readFile(resolve(filename)), target);
    console.log(`已恢复到：${target}\n停止应用，将 .env 的 DATA_DIR 改为此目录，再启动并重新授权。`);
  } else throw new Error('用法：npm run backup -- [备份文件] [--data-dir 数据目录]\n或：npm run restore -- 备份文件 --data-dir 新目录');
} catch (error) { console.error(error instanceof Error ? error.message : '数据操作失败。'); process.exitCode = 1; }
