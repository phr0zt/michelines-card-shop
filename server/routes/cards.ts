import { Router, type Request } from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { z } from 'zod';
import { CARD_STATUSES, CATEGORIES } from '../../shared/constants';
import type { AppContext } from '../context';
import { badRequest, idParam, notFound, parse } from '../lib/http';
import {
  addImage,
  cardFacets,
  cardQuerySchema,
  createCard,
  deleteCard,
  getCardDetail,
  getCardRow,
  listCards,
  updateCard,
} from '../services/cards';
import type { StoredImage } from '../services/images';
import { createInquiry } from '../services/inquiries';
import { createListing, endListings } from '../services/listings';
import { addManualPriceCheck } from '../services/priceChecks';
import { assignCards, unassignCards } from '../services/purchases';
import { createSale } from '../services/sales';
import { nowIso } from '../lib/time';
import { logActivity } from '../services/common';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 12 },
});

type Side = 'front' | 'back' | 'extra';

function truthy(v: unknown): boolean {
  return v === true || v === '1' || v === 'true';
}

function bodyData(req: Request): Record<string, unknown> {
  const raw = req.body?.data;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      throw badRequest('Card data is not valid JSON');
    }
  }
  if (req.is('application/json') && req.body && typeof req.body === 'object') {
    const { identify: _i, research: _r, category_hint: _c, ...rest } = req.body as Record<string, unknown>;
    return rest;
  }
  return {};
}

const bulkSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
  action: z.enum([
    'status',
    'public',
    'binder',
    'category',
    'identify',
    'research',
    'delete',
    'purchase',
    'list',
    'end_listings',
    'price_from_value',
  ]),
  value: z.unknown().optional(),
});

export function cardRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db, images, jobs } = ctx;

  r.get('/cards', (req, res) => {
    res.json(listCards(db, parse(cardQuerySchema, req.query)));
  });

  r.get('/cards/facets', (_req, res) => {
    res.json(cardFacets(db));
  });

  r.post(
    '/cards',
    upload.fields([
      { name: 'front', maxCount: 1 },
      { name: 'back', maxCount: 1 },
      { name: 'extra', maxCount: 8 },
    ]),
    async (req, res) => {
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
      const data = bodyData(req);
      const stored: { side: Side; img: StoredImage }[] = [];
      try {
        for (const side of ['front', 'back', 'extra'] as const) {
          for (const file of files[side] ?? []) stored.push({ side, img: await images.save(file.buffer) });
        }
        const id = createCard(db, data as Parameters<typeof createCard>[1]);
        for (const s of stored) addImage(db, id, s.side, s.img, false, images);

        const hint = typeof req.body?.category_hint === 'string' ? req.body.category_hint : undefined;
        if (truthy(req.body?.identify) && stored.length > 0 && jobs.configured) {
          jobs.enqueue(id, 'identify', {
            categoryHint: hint && (CATEGORIES as readonly string[]).includes(hint) ? hint : undefined,
            thenPrice: req.body?.research === undefined ? undefined : truthy(req.body.research),
          });
        }
        res.status(201).json(getCardDetail(db, id));
      } catch (err) {
        for (const s of stored) images.remove(s.img.key);
        throw err;
      }
    },
  );

  r.post('/cards/bulk', async (req, res) => {
    const { ids, action, value } = parse(bulkSchema, req.body);
    let ok = 0;
    const failed: { id: number; error: string }[] = [];
    const each = (fn: (id: number) => void) => {
      for (const id of ids) {
        try {
          fn(id);
          ok++;
        } catch (err) {
          failed.push({ id, error: err instanceof Error ? err.message : 'Failed' });
        }
      }
    };
    switch (action) {
      case 'status': {
        const status = parse(z.enum(CARD_STATUSES), value);
        each((id) => updateCard(db, id, { status }));
        break;
      }
      case 'public':
        each((id) => updateCard(db, id, { is_public: Boolean(value) }));
        break;
      case 'binder':
        each((id) => updateCard(db, id, { location_binder: parse(z.string().trim().max(120), value ?? '') }));
        break;
      case 'category':
        each((id) => updateCard(db, id, { category: parse(z.string().trim().min(1).max(60), value) }));
        break;
      case 'identify':
        each((id) => jobs.enqueue(id, 'identify', { overwrite: false }));
        break;
      case 'research':
        each((id) => jobs.enqueue(id, 'price'));
        break;
      case 'delete':
        each((id) => deleteCard(db, images, id));
        break;
      case 'purchase': {
        const purchaseId = parse(z.number().int().positive().nullable(), value ?? null);
        if (purchaseId === null) {
          for (const id of ids) {
            const card = getCardRow(db, id);
            if (card.purchase_id) ok += unassignCards(db, card.purchase_id, [id]);
          }
        } else {
          ok += assignCards(db, purchaseId, ids);
        }
        break;
      }
      case 'list': {
        const { platform_id } = parse(z.object({ platform_id: z.number().int().positive() }), value);
        each((id) => {
          const exists = db
            .prepare("SELECT 1 FROM listings WHERE card_id = ? AND platform_id = ? AND status = 'active'")
            .get(id, platform_id);
          if (exists) throw new Error('Already listed there');
          createListing(db, id, { platform_id });
        });
        break;
      }
      case 'end_listings': {
        const { platform_id } = parse(z.object({ platform_id: z.number().int().positive() }), value);
        const listingIds = (
          db
            .prepare(
              `SELECT id FROM listings WHERE status = 'active' AND platform_id = ? AND card_id IN (${ids.map(() => '?').join(',')})`,
            )
            .all(platform_id, ...ids) as { id: number }[]
        ).map((l) => l.id);
        ok = endListings(db, listingIds);
        break;
      }
      case 'price_from_value': {
        const { percent, only_missing } = parse(
          z.object({ percent: z.number().min(1).max(1000), only_missing: z.boolean().default(true) }),
          value,
        );
        each((id) => {
          const card = getCardRow(db, id);
          if (card.market_value_cents === null) throw new Error('No market value yet');
          if (only_missing && card.asking_price_cents !== null) throw new Error('Already has an asking price');
          const cents = Math.max(25, Math.round((card.market_value_cents * percent) / 100 / 25) * 25);
          updateCard(db, id, { asking_price_cents: cents });
        });
        break;
      }
    }
    res.json({ ok, failed });
  });

  r.get('/cards/:id', (req, res) => {
    res.json(getCardDetail(db, idParam(req)));
  });

  r.patch('/cards/:id', (req, res) => {
    const id = idParam(req);
    updateCard(db, id, req.body ?? {});
    res.json(getCardDetail(db, id));
  });

  r.delete('/cards/:id', (req, res) => {
    deleteCard(db, images, idParam(req));
    res.status(204).end();
  });

  // ---- photos

  r.post('/cards/:id/images', upload.single('file'), async (req, res) => {
    const id = idParam(req);
    getCardRow(db, id);
    const side = parse(z.enum(['front', 'back', 'extra']), req.body?.side ?? 'extra');
    if (!req.file) throw badRequest('Choose a photo to upload');
    const img = await images.save(req.file.buffer);
    try {
      addImage(db, id, side, img, truthy(req.body?.replace ?? '1'), images);
    } catch (err) {
      images.remove(img.key);
      throw err;
    }
    logActivity(db, id, 'photo', `${side === 'extra' ? 'Extra' : side === 'front' ? 'Front' : 'Back'} photo uploaded`);
    res.status(201).json(getCardDetail(db, id));
  });

  r.delete('/cards/:id/images/:imageId', (req, res) => {
    const id = idParam(req);
    const imageId = idParam(req, 'imageId');
    const row = db.prepare('SELECT file_key FROM card_images WHERE id = ? AND card_id = ?').get(imageId, id) as
      | { file_key: string }
      | undefined;
    if (!row) throw notFound('Photo not found');
    db.prepare('DELETE FROM card_images WHERE id = ?').run(imageId);
    images.remove(row.file_key);
    res.json(getCardDetail(db, id));
  });

  r.post('/cards/:id/images/:imageId/rotate', async (req, res) => {
    const id = idParam(req);
    const imageId = idParam(req, 'imageId');
    const degrees = parse(z.union([z.literal(90), z.literal(180), z.literal(270)]), req.body?.degrees ?? 90);
    const row = db.prepare('SELECT file_key FROM card_images WHERE id = ? AND card_id = ?').get(imageId, id) as
      | { file_key: string }
      | undefined;
    if (!row) throw notFound('Photo not found');
    const rotated = await images.rotate(row.file_key, degrees);
    db.prepare('UPDATE card_images SET file_key = ?, width = ?, height = ? WHERE id = ?').run(
      rotated.key,
      rotated.width,
      rotated.height,
      imageId,
    );
    res.json(getCardDetail(db, id));
  });

  r.post('/cards/:id/images/swap', (req, res) => {
    const id = idParam(req);
    getCardRow(db, id);
    db.prepare(
      "UPDATE card_images SET side = CASE side WHEN 'front' THEN 'back' WHEN 'back' THEN 'front' ELSE side END WHERE card_id = ?",
    ).run(id);
    db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(nowIso(), id);
    res.json(getCardDetail(db, id));
  });

  // ---- AI

  r.post('/cards/:id/identify', (req, res) => {
    const id = idParam(req);
    const body = parse(
      z.object({ overwrite: z.boolean().optional(), then_price: z.boolean().optional() }).strict(),
      req.body ?? {},
    );
    jobs.enqueue(id, 'identify', { overwrite: body.overwrite, thenPrice: body.then_price });
    res.status(202).json(getCardDetail(db, id));
  });

  r.post('/cards/:id/research', (req, res) => {
    const id = idParam(req);
    jobs.enqueue(id, 'price');
    res.status(202).json(getCardDetail(db, id));
  });

  // ---- things that belong to a card

  r.post('/cards/:id/listings', (req, res) => {
    const id = idParam(req);
    createListing(db, id, req.body ?? {});
    res.status(201).json(getCardDetail(db, id));
  });

  r.post('/cards/:id/inquiries', (req, res) => {
    const id = idParam(req);
    createInquiry(db, id, req.body ?? {});
    res.status(201).json(getCardDetail(db, id));
  });

  r.post('/cards/:id/sales', (req, res) => {
    const id = idParam(req);
    const result = createSale(db, id, req.body ?? {});
    res.status(201).json({ card: getCardDetail(db, id), sale: result.sale, still_listed: result.still_listed });
  });

  r.post('/cards/:id/price-checks', (req, res) => {
    const id = idParam(req);
    addManualPriceCheck(db, id, req.body ?? {});
    res.status(201).json(getCardDetail(db, id));
  });

  r.get('/cards/:id/qr.svg', async (req, res) => {
    const id = idParam(req);
    getCardRow(db, id);
    const url = `${req.protocol}://${req.get('host')}/admin/cards/${id}`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').set('Cache-Control', 'private, max-age=86400').send(svg);
  });

  return r;
}
