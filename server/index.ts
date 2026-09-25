import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app';
import { recordValueSnapshot } from './services/analytics';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const port = Number(process.env.PORT ?? 3001);
// `--data=<dir>` or DATA_DIR wins, then an attached Railway volume, then the image default (/data in Docker).
const dataArg = process.argv.find((a) => a.startsWith('--data='))?.slice('--data='.length);
const dataDir = path.resolve(
  dataArg || process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DEFAULT_DATA_DIR || './data',
);
const storageWarning =
  process.env.RAILWAY_PROJECT_ID && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DATA_DIR && !dataArg
    ? 'No Railway volume is attached, so cards and photos will be erased on the next deploy. Add a volume to this service (mount path /data) in Railway.'
    : null;
const adminPassword = process.env.ADMIN_PASSWORD ?? '';
const webDir = process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : path.join(import.meta.dirname, 'web');

const { app, ctx, close } = createApp({
  dataDir,
  adminPassword,
  sessionSecret: process.env.SESSION_SECRET,
  webDir,
  storageWarning,
});

if (storageWarning) console.warn(`⚠ ${storageWarning}`);
if (!adminPassword) {
  console.warn('⚠ ADMIN_PASSWORD is not set — nobody can log in to /admin until you set it.');
}
if (!ctx.jobs.configured) {
  console.warn('ℹ ANTHROPIC_API_KEY is not set — AI card identification and price research are turned off.');
}

ctx.jobs.start();
recordValueSnapshot(ctx.db);
const snapshotTimer = setInterval(() => recordValueSnapshot(ctx.db), 6 * 60 * 60 * 1000);
snapshotTimer.unref();

const server = app.listen(port, () => {
  console.log(`Card shop running on http://localhost:${port}  (data: ${dataDir})`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down…`);
  server.close(() => {
    close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
