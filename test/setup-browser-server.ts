// Synthetic account and isolated persistent data for UI acceptance, never production auth.
import { createApp } from '../src/server.ts';
import { AppError } from '../src/domain.ts';
import { FakeAI } from './fixtures.ts';
class SetupAI extends FakeAI { override async login() { this.authenticated = true; } }
const ai = new SetupAI(); ai.authenticated = process.env.FIXTURE_CONNECTED === '1';
if (!process.env.FIXTURE_DATA_DIR) throw new Error('FIXTURE_DATA_DIR is required to keep acceptance data isolated.');
const app = await createApp({ dataDir: process.env.FIXTURE_DATA_DIR, sourceDir: null, ai, voiceRpcFactory: async () => { throw new AppError(503, '未找到 Codex CLI，请先安装并登录 Codex。'); } });
app.server.listen(Number(process.env.FIXTURE_PORT ?? '3004'), '127.0.0.1', () => console.log('Setup UI fixture ready.'));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
