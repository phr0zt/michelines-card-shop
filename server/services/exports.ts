import { cardLabel } from '../../shared/cardText';
import { saleNetCents, type SaleMoney } from '../../shared/money';
import type { Db } from '../db';
import type { CardRow } from './cards';

type Cell = string | number | boolean | null | undefined;

/** Spreadsheet apps run cells starting with = + - @ as formulas; prefix text cells so they stay text. */
function escapeCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

const dollars = (cents: number | null | undefined): number | null =>
  cents === null || cents === undefined ? null : Math.round(cents) / 100;

interface CardLabelColumns {
  sku: string;
  year: string;
  brand: string;
  set_name: string;
  subset: string;
  card_number: string;
  player: string;
}

export function cardsCsv(db: Db): string {
  const rows = db
    .prepare(
      `SELECT c.*,
         (SELECT group_concat(p.name, '; ') FROM listings l JOIN platforms p ON p.id = l.platform_id
            WHERE l.card_id = c.id AND l.status = 'active') AS listed_on,
         (SELECT COUNT(*) FROM inquiries i WHERE i.card_id = c.id) AS inquiries
       FROM cards c ORDER BY c.id`,
    )
    .all() as (CardRow & { listed_on: string | null; inquiries: number })[];
  const headers = [
    'SKU', 'Status', 'Category', 'Card', 'Player', 'Team', 'Year', 'Brand', 'Set', 'Subset', 'Card #', 'Parallel',
    'Serial #', 'Rookie', 'Autograph', 'Memorabilia', 'Graded', 'Grader', 'Grade', 'Cert #', 'Condition', 'Quantity',
    'Quantity sold', 'Binder', 'Page', 'Slot', 'Cost each', 'Acquired', 'Acquired from', 'Market value', 'Value low',
    'Value high', 'Value checked', 'Asking price', 'Floor price', 'On website', 'Listed on', 'Inquiries', 'Title',
    'Description', 'Notes', 'Tags', 'Added', 'Sold',
  ];
  return toCsv(
    headers,
    rows.map((c) => [
      c.sku, c.status, c.category, cardLabel(c), c.player, c.team, c.year, c.brand, c.set_name, c.subset, c.card_number,
      c.parallel, c.serial_number, Boolean(c.is_rookie), Boolean(c.is_autograph), Boolean(c.is_memorabilia),
      Boolean(c.is_graded), c.grading_company, c.grade, c.cert_number, c.condition, c.quantity, c.quantity_sold,
      c.location_binder, c.location_page, c.location_slot, dollars(c.cost_cents), c.acquired_date, c.acquired_from,
      dollars(c.market_value_cents), dollars(c.market_low_cents), dollars(c.market_high_cents),
      c.market_checked_at ? c.market_checked_at.slice(0, 10) : '', dollars(c.asking_price_cents),
      dollars(c.floor_price_cents), Boolean(c.is_public), c.listed_on, c.inquiries, c.title, c.description, c.notes,
      c.tags, c.created_at.slice(0, 10), c.sold_at,
    ]),
  );
}

interface SaleCsvRow extends SaleMoney, CardLabelColumns {
  sold_on: string;
  platform: string | null;
  quantity: number;
  buyer_name: string;
  buyer_contact: string;
  payment_method: string;
  fulfillment: string;
  tracking_number: string;
  notes: string;
}

export function salesCsv(db: Db, from?: string, to?: string): string {
  const rows = db
    .prepare(
      `SELECT s.*, c.sku, c.year, c.brand, c.set_name, c.subset, c.card_number, c.player, p.name AS platform
       FROM sales s JOIN cards c ON c.id = s.card_id LEFT JOIN platforms p ON p.id = s.platform_id
       WHERE (? IS NULL OR s.sold_on >= ?) AND (? IS NULL OR s.sold_on <= ?)
       ORDER BY s.sold_on, s.id`,
    )
    .all(from ?? null, from ?? null, to ?? null, to ?? null) as SaleCsvRow[];
  const headers = [
    'Date', 'SKU', 'Card', 'Platform', 'Quantity', 'Sale price', 'Shipping charged', 'Shipping cost', 'Fees',
    'Other costs', 'Cost of card', 'Net profit', 'Buyer', 'Buyer contact', 'Payment', 'Fulfillment', 'Tracking #', 'Notes',
  ];
  return toCsv(
    headers,
    rows.map((s) => [
      s.sold_on, s.sku, cardLabel(s), s.platform ?? '', s.quantity, dollars(s.sale_price_cents),
      dollars(s.shipping_charged_cents), dollars(s.shipping_cost_cents), dollars(s.fees_cents), dollars(s.other_costs_cents),
      dollars(s.cost_basis_cents), dollars(saleNetCents(s)), s.buyer_name, s.buyer_contact, s.payment_method, s.fulfillment,
      s.tracking_number, s.notes,
    ]),
  );
}

interface InquiryCsvRow extends CardLabelColumns {
  created_at: string;
  platform: string | null;
  name: string;
  contact: string;
  offer_cents: number | null;
  status: string;
  follow_up_on: string | null;
  message: string;
  source: string;
}

export function inquiriesCsv(db: Db): string {
  const rows = db
    .prepare(
      `SELECT i.*, c.sku, c.year, c.brand, c.set_name, c.subset, c.card_number, c.player, p.name AS platform
       FROM inquiries i JOIN cards c ON c.id = i.card_id LEFT JOIN platforms p ON p.id = i.platform_id ORDER BY i.id`,
    )
    .all() as InquiryCsvRow[];
  return toCsv(
    ['Received', 'SKU', 'Card', 'Platform', 'Name', 'Contact', 'Offer', 'Status', 'Follow up', 'Message', 'Source'],
    rows.map((i) => [
      i.created_at.slice(0, 10), i.sku, cardLabel(i), i.platform ?? '', i.name, i.contact, dollars(i.offer_cents),
      i.status, i.follow_up_on, i.message, i.source,
    ]),
  );
}

interface PurchaseCsvRow {
  purchased_on: string;
  source: string;
  description: string;
  total_cost_cents: number;
  cards: number;
  notes: string;
}

export function purchasesCsv(db: Db): string {
  const rows = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM cards c WHERE c.purchase_id = p.id) AS cards
       FROM purchases p ORDER BY p.purchased_on, p.id`,
    )
    .all() as PurchaseCsvRow[];
  return toCsv(
    ['Date', 'Bought from', 'Description', 'Total cost', 'Cards linked', 'Notes'],
    rows.map((p) => [p.purchased_on, p.source, p.description, dollars(p.total_cost_cents), p.cards, p.notes]),
  );
}
