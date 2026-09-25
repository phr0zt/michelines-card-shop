import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { AppContext } from './context';
import { openDb } from './db';
import { createAuth } from './lib/auth';
import { errorHandler } from './lib/http';
import { analyticsRoutes } from './routes/analytics';
import { cardRoutes } from './routes/cards';
import { exportRoutes } from './routes/exports';
import { publicRoutes } from './routes/public';
import { recordRoutes } from './routes/records';
import { settingsRoutes } from './routes/settings';
import { createAiClient, type AiClient } from './services/ai/client';
import { JobRunner } from './services/ai/jobs';
import { ImageStore } from './services/images';

export interface AppOptions {
  dataDir: string;
  adminPassword: string;
  sessionSecret?: string;
  /** Built web app (dist/web). When missing, only the API is served (Vite serves the UI in dev). */
  webDir?: string | null;
  /** Override the Anthropic client (tests pass a fake; null disables AI). */
  aiClient?: AiClient | null;
  aiConcurrency?: number;
  /** Shown to the owner in the admin when data isn't on persistent storage. */
  storageWarning?: string | null;
}

/** A random secret persisted next to the database, so logins survive restarts. */
function loadOrCreateSecret(dataDir: string): string {
  const file = path.join(dataDir, '.session-secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // create below
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
].join('; ');

export function createApp(opts: AppOptions) {
  fs.mkdirSync(opts.dataDir, { recursive: true });
  const db = openDb(path.join(opts.dataDir, 'cards.db'));
  const images = new ImageStore(path.join(opts.dataDir, 'uploads'));
  const client = opts.aiClient === undefined ? createAiClient() : opts.aiClient;
  const jobs = new JobRunner(db, images, client, opts.aiConcurrency ?? 2);
  const auth = createAuth({
    password: opts.adminPassword,
    secret: opts.sessionSecret || loadOrCreateSecret(opts.dataDir),
  });
  const ctx: AppContext = { db, images, jobs, auth };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', CSP);
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/auth/session', (req, res) => {
    res.json({ authenticated: auth.isAuthenticated(req), password_configured: auth.passwordConfigured });
  });
  app.post('/api/auth/login', auth.login);
  app.post('/api/auth/logout', auth.logout);

  app.get('/api/system', auth.requireAuth, (_req, res) => {
    res.json({ storage_warning: opts.storageWarning ?? null });
  });

  app.use('/api', publicRoutes(ctx));
  app.use(
    '/api',
    auth.requireAuth,
    cardRoutes(ctx),
    recordRoutes(ctx),
    analyticsRoutes(ctx),
    settingsRoutes(ctx),
    exportRoutes(ctx),
  );
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(
    '/media',
    express.static(images.root, { immutable: true, maxAge: '365d', index: false, fallthrough: false, dotfiles: 'deny' }),
  );

  const webDir = opts.webDir;
  if (webDir && fs.existsSync(path.join(webDir, 'index.html'))) {
    const indexHtml = path.join(webDir, 'index.html');
    app.use(
      '/assets',
      express.static(path.join(webDir, 'assets'), { immutable: true, maxAge: '365d', index: false, fallthrough: false }),
    );
    app.use(express.static(webDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.set('Cache-Control', 'no-cache').sendFile(indexHtml);
    });
  }

  app.use(errorHandler);

  function close(): void {
    jobs.stop();
    db.close();
  }

  return { app, ctx, close };
}
