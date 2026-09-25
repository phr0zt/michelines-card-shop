import { Router } from 'express';
import { z } from 'zod';
import { COST_ALLOCATION_METHODS } from '../../shared/constants';
import type { AppContext } from '../context';
import { idParam, parse } from '../lib/http';
import { getCardDetail } from '../services/cards';
import { deleteInquiry, getInquiry, inquiryQuerySchema, listInquiries, updateInquiry } from '../services/inquiries';
import { deleteListing, endListings, updateListing } from '../services/listings';
import { createPlatform, deletePlatform, listPlatforms, updatePlatform } from '../services/platforms';
import { deletePriceCheck } from '../services/priceChecks';
import {
  applyAllocation,
  assignCards,
  createPurchase,
  deletePurchase,
  getPurchase,
  listPurchases,
  previewAllocation,
  unassignCards,
  updatePurchase,
} from '../services/purchases';
import { deleteSale, getSale, listSales, saleQuerySchema, updateSale } from '../services/sales';

const idsSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) });
const cardIdsSchema = z.object({ card_ids: z.array(z.number().int().positive()).min(1).max(5000) });

export function recordRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  // listings
  r.patch('/listings/:id', (req, res) => {
    const listing = updateListing(db, idParam(req), req.body ?? {});
    res.json(getCardDetail(db, listing.card_id));
  });
  r.delete('/listings/:id', (req, res) => {
    const id = idParam(req);
    const row = db.prepare('SELECT card_id FROM listings WHERE id = ?').get(id) as { card_id: number } | undefined;
    deleteListing(db, id);
    res.json(row ? getCardDetail(db, row.card_id) : {});
  });
  r.post('/listings/end', (req, res) => {
    const { ids } = parse(idsSchema, req.body);
    res.json({ ended: endListings(db, ids) });
  });

  // inquiries
  r.get('/inquiries', (req, res) => {
    res.json(listInquiries(db, parse(inquiryQuerySchema, req.query)));
  });
  r.patch('/inquiries/:id', (req, res) => {
    res.json(updateInquiry(db, idParam(req), req.body ?? {}));
  });
  r.delete('/inquiries/:id', (req, res) => {
    const inquiry = getInquiry(db, idParam(req));
    deleteInquiry(db, inquiry.id);
    res.status(204).end();
  });

  // sales
  r.get('/sales', (req, res) => {
    res.json(listSales(db, parse(saleQuerySchema, req.query)));
  });
  r.patch('/sales/:id', (req, res) => {
    res.json(updateSale(db, idParam(req), req.body ?? {}));
  });
  r.delete('/sales/:id', (req, res) => {
    const sale = getSale(db, idParam(req));
    deleteSale(db, sale.id);
    res.status(204).end();
  });

  // price checks
  r.delete('/price-checks/:id', (req, res) => {
    deletePriceCheck(db, idParam(req));
    res.status(204).end();
  });

  // purchases
  r.get('/purchases', (_req, res) => {
    res.json(listPurchases(db));
  });
  r.post('/purchases', (req, res) => {
    res.status(201).json(createPurchase(db, req.body ?? {}));
  });
  r.get('/purchases/:id', (req, res) => {
    res.json(getPurchase(db, idParam(req)));
  });
  r.patch('/purchases/:id', (req, res) => {
    res.json(updatePurchase(db, idParam(req), req.body ?? {}));
  });
  r.delete('/purchases/:id', (req, res) => {
    deletePurchase(db, idParam(req));
    res.status(204).end();
  });
  r.post('/purchases/:id/cards', (req, res) => {
    const id = idParam(req);
    const { card_ids } = parse(cardIdsSchema, req.body);
    res.json({ assigned: assignCards(db, id, card_ids), purchase: getPurchase(db, id) });
  });
  r.post('/purchases/:id/unassign', (req, res) => {
    const id = idParam(req);
    const { card_ids } = parse(cardIdsSchema, req.body);
    res.json({ removed: unassignCards(db, id, card_ids), purchase: getPurchase(db, id) });
  });
  r.post('/purchases/:id/allocate', (req, res) => {
    const id = idParam(req);
    const body = parse(z.object({ method: z.enum(COST_ALLOCATION_METHODS), apply: z.boolean().default(false) }), req.body);
    res.json(body.apply ? applyAllocation(db, id, body.method) : previewAllocation(db, id, body.method));
  });

  // platforms
  r.get('/platforms', (_req, res) => {
    res.json(listPlatforms(db));
  });
  r.post('/platforms', (req, res) => {
    res.status(201).json(createPlatform(db, req.body ?? {}));
  });
  r.patch('/platforms/:id', (req, res) => {
    res.json(updatePlatform(db, idParam(req), req.body ?? {}));
  });
  r.delete('/platforms/:id', (req, res) => {
    deletePlatform(db, idParam(req));
    res.status(204).end();
  });

  return r;
}
