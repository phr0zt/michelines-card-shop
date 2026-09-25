import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { createApp, type AppOptions } from '../server/app';
import type { AiClient } from '../server/services/ai/client';

export const PASSWORD = 'test-password';

export async function makeJpeg(color = '#3355aa', width = 600, height = 840): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

export function makeTestApp(aiClient: AiClient | null = null, options: Partial<AppOptions> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-shop-test-'));
  const created = createApp({ dataDir, adminPassword: PASSWORD, sessionSecret: 'x'.repeat(64), aiClient, webDir: null, ...options });
  const agent = request.agent(created.app);
  return {
    ...created,
    dataDir,
    agent,
    async login() {
      await agent.post('/api/auth/login').send({ password: PASSWORD }).expect(200);
      return agent;
    },
    cleanup() {
      created.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
