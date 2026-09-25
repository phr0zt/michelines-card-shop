import type {
  AiJobKind,
  AiJobStatus,
  FulfillmentStatus,
  InquiryStatus,
  ListingStatus,
  PlatformKind,
  PriceConfidence,
} from '../../shared/constants';
import { saleNetCents } from '../../shared/money';
import type {
  Activity,
  AiJob,
  Inquiry,
  Listing,
  Platform,
  PriceCheck,
  PriceComp,
  PriceSource,
  Purchase,
  Sale,
} from '../../shared/types';
import { bool, summaryFromPrefixed } from './common';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function platformFromRow(r: Row): Platform {
  return {
    id: num(r.id),
    name: str(r.name),
    kind: str(r.kind) as PlatformKind,
    fee_percent: num(r.fee_percent),
    fee_fixed_cents: num(r.fee_fixed_cents),
    color: str(r.color),
    url: str(r.url),
    active: bool(r.active),
    sort_order: num(r.sort_order),
  };
}

export function listingFromRow(r: Row): Listing {
  return {
    id: num(r.id),
    card_id: num(r.card_id),
    platform_id: num(r.platform_id),
    status: str(r.status) as ListingStatus,
    price_cents: numOrNull(r.price_cents),
    url: str(r.url),
    channel: str(r.channel),
    external_id: str(r.external_id),
    listed_at: strOrNull(r.listed_at),
    ended_at: strOrNull(r.ended_at),
    notes: str(r.notes),
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}

export function inquiryFromRow(r: Row): Inquiry {
  const inquiry: Inquiry = {
    id: num(r.id),
    card_id: num(r.card_id),
    platform_id: numOrNull(r.platform_id),
    name: str(r.name),
    contact: str(r.contact),
    message: str(r.message),
    offer_cents: numOrNull(r.offer_cents),
    status: str(r.status) as InquiryStatus,
    follow_up_on: strOrNull(r.follow_up_on),
    source: str(r.source) === 'storefront' ? 'storefront' : 'manual',
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
  const card = summaryFromPrefixed(r);
  if (card) inquiry.card = card;
  return inquiry;
}

export function saleFromRow(r: Row): Sale {
  const money = {
    sale_price_cents: num(r.sale_price_cents),
    shipping_charged_cents: num(r.shipping_charged_cents),
    shipping_cost_cents: num(r.shipping_cost_cents),
    fees_cents: num(r.fees_cents),
    other_costs_cents: num(r.other_costs_cents),
    cost_basis_cents: num(r.cost_basis_cents),
  };
  const sale: Sale = {
    id: num(r.id),
    card_id: num(r.card_id),
    platform_id: numOrNull(r.platform_id),
    inquiry_id: numOrNull(r.inquiry_id),
    quantity: num(r.quantity),
    ...money,
    net_cents: saleNetCents(money),
    buyer_name: str(r.buyer_name),
    buyer_contact: str(r.buyer_contact),
    payment_method: str(r.payment_method),
    sold_on: str(r.sold_on),
    fulfillment: str(r.fulfillment) as FulfillmentStatus,
    tracking_number: str(r.tracking_number),
    notes: str(r.notes),
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
  const card = summaryFromPrefixed(r);
  if (card) sale.card = card;
  return sale;
}

export function priceCheckFromRow(r: Row): PriceCheck {
  return {
    id: num(r.id),
    card_id: num(r.card_id),
    source: str(r.source) === 'manual' ? 'manual' : 'ai',
    currency: str(r.currency),
    low_cents: numOrNull(r.low_cents),
    mid_cents: numOrNull(r.mid_cents),
    high_cents: numOrNull(r.high_cents),
    suggested_price_cents: numOrNull(r.suggested_price_cents),
    quick_sale_cents: numOrNull(r.quick_sale_cents),
    confidence: (strOrNull(r.confidence) as PriceConfidence | null) ?? null,
    summary: str(r.summary),
    advice: str(r.advice),
    comps: safeJson<PriceComp[]>(r.comps_json, []),
    sources: safeJson<PriceSource[]>(r.sources_json, []),
    model: str(r.model),
    created_at: str(r.created_at),
  };
}

export function jobFromRow(r: Row): AiJob {
  return {
    id: num(r.id),
    card_id: num(r.card_id),
    kind: str(r.kind) as AiJobKind,
    status: str(r.status) as AiJobStatus,
    error: strOrNull(r.error),
    created_at: str(r.created_at),
    started_at: strOrNull(r.started_at),
    finished_at: strOrNull(r.finished_at),
  };
}

export function purchaseFromRow(r: Row): Purchase {
  return {
    id: num(r.id),
    purchased_on: str(r.purchased_on),
    source: str(r.source),
    description: str(r.description),
    total_cost_cents: num(r.total_cost_cents),
    notes: str(r.notes),
    card_count: num(r.card_count),
    allocated_cents: num(r.allocated_cents),
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}

export function activityFromRow(r: Row): Activity {
  return {
    id: num(r.id),
    card_id: numOrNull(r.card_id),
    kind: str(r.kind),
    message: str(r.message),
    created_at: str(r.created_at),
  };
}
