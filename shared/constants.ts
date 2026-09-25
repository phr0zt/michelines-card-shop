export const CATEGORIES = [
  'Hockey',
  'Baseball',
  'Basketball',
  'Football',
  'Soccer',
  'Racing',
  'Wrestling',
  'Golf',
  'Other Sports',
  'Pokémon',
  'Magic: The Gathering',
  'Yu-Gi-Oh!',
  'One Piece',
  'Lorcana',
  'Other TCG',
  'Non-Sport',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CARD_STATUSES = ['draft', 'in_stock', 'listed', 'pending', 'sold', 'keeper'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const STATUS_LABELS: Record<CardStatus, string> = {
  draft: 'Needs review',
  in_stock: 'In inventory',
  listed: 'Listed for sale',
  pending: 'Sale pending',
  sold: 'Sold',
  keeper: 'Keeper (not for sale)',
};

/** Statuses a person sets by hand; the others are derived from listings and sales. */
export const MANUAL_STATUSES: readonly CardStatus[] = ['draft', 'pending', 'keeper'];

export const CONDITIONS = [
  'Gem Mint',
  'Mint',
  'Near Mint-Mint',
  'Near Mint',
  'Excellent-Mint',
  'Excellent',
  'Very Good-Excellent',
  'Very Good',
  'Good',
  'Fair',
  'Poor',
] as const;

export const GRADING_COMPANIES = ['PSA', 'BGS', 'SGC', 'CGC', 'TAG', 'KSA', 'HGA', 'Other'] as const;

export const LISTING_STATUSES = ['active', 'ended', 'sold'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  active: 'Active',
  ended: 'Ended / removed',
  sold: 'Sold here',
};

export const INQUIRY_STATUSES = ['new', 'replied', 'negotiating', 'accepted', 'declined', 'closed'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  new: 'New',
  replied: 'Replied',
  negotiating: 'Negotiating',
  accepted: 'Deal agreed',
  declined: 'Declined',
  closed: 'Closed',
};
export const OPEN_INQUIRY_STATUSES: readonly InquiryStatus[] = ['new', 'replied', 'negotiating', 'accepted'];

export const FULFILLMENT_STATUSES = ['pending', 'shipped', 'delivered', 'picked_up'] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];
export const FULFILLMENT_LABELS: Record<FulfillmentStatus, string> = {
  pending: 'To ship / hand over',
  shipped: 'Shipped',
  delivered: 'Delivered',
  picked_up: 'Picked up / in person',
};

export const PAYMENT_METHODS = [
  'Cash',
  'Interac e-Transfer',
  'PayPal',
  'PayPal Goods & Services',
  'Credit / debit card',
  'Marketplace payout',
  'Trade',
  'Other',
] as const;

export const PLATFORM_KINDS = ['marketplace', 'classifieds', 'social', 'auction', 'in_person', 'website', 'other'] as const;
export type PlatformKind = (typeof PLATFORM_KINDS)[number];
export const PLATFORM_KIND_LABELS: Record<PlatformKind, string> = {
  marketplace: 'Online marketplace',
  classifieds: 'Classifieds',
  social: 'Social media / groups',
  auction: 'Auction / live selling',
  in_person: 'In person',
  website: 'Our website',
  other: 'Other',
};

export const AI_JOB_KINDS = ['identify', 'price'] as const;
export type AiJobKind = (typeof AI_JOB_KINDS)[number];
export const AI_JOB_STATUSES = ['queued', 'running', 'done', 'error'] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

export const AI_EFFORTS = ['low', 'medium', 'high'] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

export const AI_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 (most accurate, default)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (faster, about 60% cheaper)' },
] as const;

export const PRICE_CONFIDENCE = ['low', 'medium', 'high'] as const;
export type PriceConfidence = (typeof PRICE_CONFIDENCE)[number];

export const COST_ALLOCATION_METHODS = ['even', 'by_value'] as const;
export type CostAllocationMethod = (typeof COST_ALLOCATION_METHODS)[number];
