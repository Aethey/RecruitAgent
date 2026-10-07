import { formatMessage } from '../../generated/localizations.ts';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { AppError } from '../errors.ts';
import type { State } from './state.ts';
import { Store } from './store.ts';
import { archiveValue } from '../../contracts/validation.ts';
import type { BackupArchive } from '../../contracts/api.ts';

const compress = promisify(gzip), decompress = promisify(gunzip);
const LIMIT = 512 * 1024 * 1024;
const fields = ['version', 'problems', 'languageDrills', 'interviewJobs', 'interviews', 'library', 'trainings', 'studyPoints', 'studyCards', 'studyBatches', 'chats', 'analysis', 'settings', 'interviewMaterials'] as const;
type Archive = BackupArchive;
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function blobName(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i.test(value); }

export async function exportBackup(store: Store, dataDir: string): Promise<Buffer> {
  await store.flush();
  const snapshot = store.snapshot();
  // Explicit state fields and referenced library blobs only: no auth, Pi sessions or voice logs.
  const state = Object.fromEntries(fields.filter(key => snapshot[key] !== undefined).map(key => [key, snapshot[key]])) as State;
  const files: Archive['files'] = [];
  let bytes = Buffer.byteLength(JSON.stringify(state));
  for (const name of new Set((state.library ?? []).map(item => item.blob))) {
    if (!blobName(name)) throw new AppError(400, formatMessage('zh', "ui.invalidMaterialFilenameCannotBackUp"));
    const data = await readFile(resolve(dataDir, 'library', name));
    bytes += Math.ceil(data.length * 4 / 3);
    if (bytes > LIMIT) throw new AppError(413, formatMessage('zh', "ui.theBackupExceedsMBManuallyBackUpThe"));
    files.push({ name, hash: hash(data), data: data.toString('base64') });
  }
  if (bytes > LIMIT) throw new AppError(413, formatMessage('zh', "ui.theBackupExceedsMB"));
  const archive: Archive = { format: 'recruitagent-backup', version: 1, createdAt: new Date().toISOString(), state, stateHash: hash(JSON.stringify(state)), files };
  const encoded = Buffer.from(JSON.stringify(archive));
  if (encoded.length > LIMIT) throw new AppError(413, formatMessage('zh', "ui.theBackupExceedsMB"));
  return compress(encoded);
}

export async function restoreBackup(data: Buffer, target: string) {
  let archive: Archive;
  try { archive = JSON.parse((await decompress(data, { maxOutputLength: LIMIT })).toString('utf8')); }
  catch { throw new Error(formatMessage('zh', "ui.theBackupCannotBeReadOrExceedsMB")); }
  archive = archiveValue(archive);
  if (archive?.format !== 'recruitagent-backup' || archive.version !== 1 || !archive.state || !Array.isArray(archive.files) || hash(JSON.stringify(archive.state)) !== archive.stateHash) throw new Error(formatMessage('zh', "ui.theBackupFormatOrValidationIsIncorrect"));
  const state = Object.fromEntries(fields.filter(key => archive.state[key] !== undefined).map(key => [key, archive.state[key]])) as State;
  const blobs = (state.library ?? []).map(item => item.blob);
  if (!blobs.every(blobName) || new Set(blobs).size !== blobs.length) throw new Error(formatMessage('zh', "ui.theSourcePathInTheBackupIsInvalid"));
  const decoded = new Map<string, Buffer>();
  for (const file of archive.files) {
    if (!blobName(file.name) || !blobs.includes(file.name) || decoded.has(file.name) || typeof file.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) throw new Error(formatMessage('zh', "ui.theSourceFileInTheBackupIsInvalid"));
    const content = Buffer.from(file.data, 'base64');
    if (hash(content) !== file.hash) throw new Error(formatMessage('zh', "ui.sourceValidationFailedForTheBackup"));
    decoded.set(file.name, content);
  }
  if (decoded.size !== blobs.length) throw new Error(formatMessage('zh', "ui.theBackupIsMissingTheOriginalSourceFile"));
  try { await lstat(target); throw new Error(formatMessage('zh', "ui.theRestoreDirectoryAlreadyExistsSpecifyANew")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await mkdir(dirname(target), { recursive: true });
  const stage = resolve(dirname(target), `.recruitagent-restore-${randomUUID()}`);
  try {
    await mkdir(resolve(stage, 'library'), { recursive: true, mode: 0o700 });
    await writeFile(resolve(stage, 'state.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
    for (const [name, content] of decoded) await writeFile(resolve(stage, 'library', name), content, { mode: 0o600 });
    const store = new Store(resolve(stage, 'state.json')); await store.load();
    await rename(stage, target);
  } finally { await rm(stage, { recursive: true, force: true }); }
}
