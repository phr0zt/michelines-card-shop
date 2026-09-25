import type {
  AiEffort,
  AiJobKind,
  AiJobStatus,
  CardStatus,
  CostAllocationMethod,
  FulfillmentStatus,
  InquiryStatus,
  ListingStatus,
  PlatformKind,
  PriceConfidence,
} from './constants';

export type ImageSide = 'front' | 'back' | 'extra';

export interface ImageUrls {
  full: string;
  md: string;
  sm: string;
}

export interface CardImage {
  id: number;
  card_id: number;
  side: ImageSide;
  width: number | null;
  height: number | null;
  sort_order: number;
  urls: ImageUrls;
}

/** Fields a person (or the AI) edits on a card. Money is always integer cents. */
export interface CardFields {
  category: string;
  player: string;
  team: string;
  year: string;
  brand: string;
  set_name: string;
  subset: string;
  card_number: string;
  parallel: string;
  serial_number: string;
  is_rookie: boolean;
  is_autograph: boolean;
  is_memorabilia: boolean;
  is_graded: boolean;
  grading_company: string;
  grade: string;
  cert_number: string;
  condition: string;
  condition_notes: string;
  quantity: number;
  location_binder: string;
  location_page: string;
  location_slot: string;
  cost_cents: number | null;
  acquired_date: string | null;
  acquired_from: string;
  purchase_id: number | null;
  asking_price_cents: number | null;
  floor_price_cents: number | null;
  title: string;
  description: string;
  notes: string;
  tags: string;
  is_public: boolean;
  featured: boolean;
}

export interface Card extends CardFields {
  id: number;
  sku: string;
  status: CardStatus;
  quantity_sold: number;
  market_value_cents: number | null;
  market_low_cents: number | null;
  market_high_cents: number | null;
  market_confidence: PriceConfidence | null;
  market_checked_at: string | null;
  ai_identified_at: string | null;
  ai_confidence: number | null;
  ai_notes: string;
  created_at: string;
  updated_at: string;
  sold_at: string | null;
  front_image: CardImage | null;
  back_image: CardImage | null;
  /** Platform ids with an active listing. */
  listed_platform_ids: number[];
  open_inquiry_count: number;
  active_job: AiJobKind | null;
}

export interface Listing {
  id: number;
  card_id: number;
  platform_id: number;
  status: ListingStatus;
  price_cents: number | null;
  url: string;
  channel: string;
  external_id: string;
  listed_at: string | null;
  ended_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface CardSummary {
  id: number;
  sku: string;
  label: string;
  status: CardStatus;
  thumb_url: string | null;
  market_value_cents: number | null;
  asking_price_cents: number | null;
}

export interface Inquiry {
  id: number;
  card_id: number;
  platform_id: number | null;
  name: string;
  contact: string;
  message: string;
  offer_cents: number | null;
  status: InquiryStatus;
  follow_up_on: string | null;
  source: 'manual' | 'storefront';
  created_at: string;
  updated_at: string;
  card?: CardSummary;
}

export interface Sale {
  id: number;
  card_id: number;
  platform_id: number | null;
  inquiry_id: number | null;
  quantity: number;
  sale_price_cents: number;
  shipping_charged_cents: number;
  shipping_cost_cents: number;
  fees_cents: number;
  other_costs_cents: number;
  cost_basis_cents: number;
  net_cents: number;
  buyer_name: string;
  buyer_contact: string;
  payment_method: string;
  sold_on: string;
  fulfillment: FulfillmentStatus;
  tracking_number: string;
  notes: string;
  created_at: string;
  updated_at: string;
  card?: CardSummary;
}

export interface Purchase {
  id: number;
  purchased_on: string;
  source: string;
  description: string;
  total_cost_cents: number;
  notes: string;
  card_count: number;
  allocated_cents: number;
  created_at: string;
  updated_at: string;
}

export interface PurchaseStats {
  cards: number;
  units: number;
  sold_units: number;
  revenue_cents: number;
  profit_cents: number;
  remaining_value_cents: number;
}

export interface PurchaseDetail extends Purchase {
  stats: PurchaseStats;
}

export interface NavCounts {
  drafts: number;
  inquiries_new: number;
  inquiries_due: number;
  to_ship: number;
  ai_queued: number;
  ai_running: number;
  sold_still_listed: number;
}

export interface Platform {
  id: number;
  name: string;
  kind: PlatformKind;
  fee_percent: number;
  fee_fixed_cents: number;
  color: string;
  url: string;
  active: boolean;
  sort_order: number;
}

export interface PriceComp {
  title: string;
  price: number;
  currency: string;
  date: string;
  venue: string;
  url: string;
  grade: string;
  sold: boolean;
}

export interface PriceSource {
  title: string;
  url: string;
}

export interface PriceCheck {
  id: number;
  card_id: number;
  source: 'ai' | 'manual';
  currency: string;
  low_cents: number | null;
  mid_cents: number | null;
  high_cents: number | null;
  suggested_price_cents: number | null;
  quick_sale_cents: number | null;
  confidence: PriceConfidence | null;
  summary: string;
  advice: string;
  comps: PriceComp[];
  sources: PriceSource[];
  model: string;
  created_at: string;
}

export interface Activity {
  id: number;
  card_id: number | null;
  kind: string;
  message: string;
  created_at: string;
}

export interface AiJob {
  id: number;
  card_id: number;
  kind: AiJobKind;
  status: AiJobStatus;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CardDetail extends Card {
  images: CardImage[];
  listings: Listing[];
  inquiries: Inquiry[];
  sales: Sale[];
  price_checks: PriceCheck[];
  activity: Activity[];
  jobs: AiJob[];
  purchase: Purchase | null;
  /** Other unsold cards with the same player, year, set, number and parallel. */
  possible_duplicates: CardSummary[];
}

export interface CardListResponse {
  cards: Card[];
  total: number;
  page: number;
  page_size: number;
  totals: { units: number; value_cents: number; asking_cents: number };
}

export interface CardFacets {
  categories: { name: string; count: number }[];
  statuses: { status: CardStatus; count: number }[];
  binders: { name: string; count: number }[];
  brands: string[];
  sets: string[];
  years: string[];
  teams: string[];
}

export interface Settings {
  store_name: string;
  store_tagline: string;
  store_intro: string;
  contact_email: string;
  contact_phone: string;
  pickup_location: string;
  currency: string;
  locale: string;
  usd_exchange_rate: number;
  sku_prefix: string;
  storefront_enabled: boolean;
  storefront_show_prices: boolean;
  shipping_note: string;
  listing_footer: string;
  ai_model: string;
  ai_effort_identify: AiEffort;
  ai_effort_price: AiEffort;
  ai_auto_price: boolean;
  ai_max_searches: number;
  stale_listing_days: number;
  high_value_cents: number;
}

export interface AiStatus {
  configured: boolean;
  model: string;
  queued: number;
  running: number;
  failed_recent: number;
  month_cost_usd: number;
  month_jobs: number;
}

export interface SessionInfo {
  authenticated: boolean;
  password_configured: boolean;
}

// ---------- Analytics ----------

export interface Overview {
  period: { from: string; to: string };
  inventory: {
    cards: number;
    units: number;
    value_cents: number;
    cost_cents: number;
    missing_value: number;
    drafts: number;
    listed_cards: number;
    active_listings: number;
    public_cards: number;
    keepers: number;
  };
  sales: {
    count: number;
    units: number;
    item_cents: number;
    shipping_income_cents: number;
    gross_cents: number;
    fees_cents: number;
    shipping_cost_cents: number;
    other_costs_cents: number;
    cogs_cents: number;
    net_cents: number;
    avg_sale_cents: number | null;
    margin_pct: number | null;
    avg_days_to_sell: number | null;
  };
  inquiries: { open: number; new_in_period: number; follow_ups_due: number };
  purchases: { count: number; spent_cents: number };
  sell_through_pct: number | null;
}

export interface TimePoint {
  period: string;
  sales: number;
  units: number;
  gross_cents: number;
  fees_cents: number;
  net_cents: number;
  cards_added: number;
  purchases_cents: number;
}

export interface PlatformStat {
  platform_id: number | null;
  name: string;
  color: string;
  sales: number;
  gross_cents: number;
  fees_cents: number;
  net_cents: number;
  avg_days_to_sell: number | null;
  active_listings: number;
  inquiries: number;
}

export interface CategoryStat {
  category: string;
  cards: number;
  units: number;
  value_cents: number;
  sold_units: number;
  sold_gross_cents: number;
}

export interface ValuePoint {
  date: string;
  value_cents: number;
  cost_cents: number;
  cards: number;
}

export interface ListingAlert {
  listing_id: number;
  platform_id: number;
  platform_name: string;
  listed_at: string | null;
  days_listed: number | null;
  price_cents: number | null;
  url: string;
  card: CardSummary;
}

export interface Mover {
  card: CardSummary;
  previous_cents: number;
  current_cents: number;
  change_pct: number;
  checked_at: string;
}

export interface Attention {
  drafts: CardSummary[];
  follow_ups: Inquiry[];
  sold_still_listed: ListingAlert[];
  stale_listings: ListingAlert[];
  unfulfilled: Sale[];
  high_value_unlisted: CardSummary[];
  no_asking_price: number;
  failed_jobs: number;
}

export interface Dashboard {
  overview: Overview;
  timeseries: TimePoint[];
  platforms: PlatformStat[];
  categories: CategoryStat[];
  value_history: ValuePoint[];
  top_cards: CardSummary[];
  movers: Mover[];
  attention: Attention;
  recent_activity: (Activity & { card?: CardSummary })[];
}

export interface PnlRow {
  period: string;
  sales: number;
  units: number;
  item_cents: number;
  shipping_income_cents: number;
  gross_cents: number;
  fees_cents: number;
  shipping_cost_cents: number;
  other_costs_cents: number;
  cogs_cents: number;
  net_cents: number;
  purchases_cents: number;
}

export interface PnlReport {
  from: string;
  to: string;
  group: 'month' | 'week' | 'day';
  rows: PnlRow[];
  totals: PnlRow;
  by_platform: PlatformStat[];
  by_category: CategoryStat[];
}

export interface AllocationPreview {
  method: CostAllocationMethod;
  total_cents: number;
  allocations: { card_id: number; cost_cents: number }[];
}

// ---------- Public storefront ----------

export interface PublicStore {
  enabled: boolean;
  name: string;
  tagline: string;
  intro: string;
  contact_email: string;
  contact_phone: string;
  pickup_location: string;
  currency: string;
  locale: string;
  show_prices: boolean;
  categories: { name: string; count: number }[];
}

export interface PublicCard {
  sku: string;
  category: string;
  player: string;
  team: string;
  year: string;
  brand: string;
  set_name: string;
  subset: string;
  card_number: string;
  parallel: string;
  serial_number: string;
  is_rookie: boolean;
  is_autograph: boolean;
  is_memorabilia: boolean;
  is_graded: boolean;
  grading_company: string;
  grade: string;
  condition: string;
  title: string;
  description: string;
  price_cents: number | null;
  availability: 'available' | 'pending';
  featured: boolean;
  images: { side: ImageSide; urls: ImageUrls }[];
}

export interface PublicCardList {
  cards: PublicCard[];
  total: number;
  page: number;
  page_size: number;
}
