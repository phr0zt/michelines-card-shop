import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { parse } from '../lib/http';
import { isIsoDate, today } from '../lib/time';
import { cardsCsv, inquiriesCsv, purchasesCsv, salesCsv } from '../services/exports';

function sendCsv(res: Response, name: string, csv: string): void {
  res
    .type('text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${name}-${today()}.csv"`)
    .set('Cache-Control', 'no-store')
    .send(csv);
}

const isoDate = z.string().refine(isIsoDate, 'Use a date like 2025-01-31');

export function exportRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;
  r.get('/export/cards.csv', (_req, res) => sendCsv(res, 'cards', cardsCsv(db)));
  r.get('/export/sales.csv', (req, res) => {
    const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional() }), req.query);
    sendCsv(res, 'sales', salesCsv(db, q.from, q.to));
  });
  r.get('/export/inquiries.csv', (_req, res) => sendCsv(res, 'inquiries', inquiriesCsv(db)));
  r.get('/export/purchases.csv', (_req, res) => sendCsv(res, 'purchases', purchasesCsv(db)));
  r.get('/export/backup.sqlite', async (_req, res) => {
    const tmp = path.join(os.tmpdir(), `card-shop-backup-${process.pid}-${Date.now()}.sqlite`);
    await db.backup(tmp);
    res.set('Cache-Control', 'no-store');
    res.download(tmp, `card-shop-backup-${today()}.sqlite`, () => {
      fs.unlink(tmp, () => undefined);
    });
  });
  return r;
}
