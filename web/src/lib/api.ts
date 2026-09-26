import type {
  AiJob,
  AiStatus,
  AllocationPreview,
  CardDetail,
  CardFacets,
  CardListResponse,
  CardSummary,
  Dashboard,
  Inquiry,
  Listing,
  NavCounts,
  Platform,
  PnlReport,
  PublicCard,
  PublicCardList,
  PublicStore,
  Purchase,
  PurchaseDetail,
  Sale,
  SessionInfo,
  Settings,
} from '@shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | null | undefined>;

export function qs(params: Params = {}): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    search.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && url.startsWith('/api/') && !url.startsWith('/api/auth') && !url.startsWith('/api/public')) {
      window.dispatchEvent(new Event('auth:expired'));
    }
    throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText ?? 'Request failed');
  }
  return data as T;
}

const get = <T>(url: string) => request<T>('GET', url);
const post = <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {});
const patch = <T>(url: string, body: unknown) => request<T>('PATCH', url, body);
const del = <T = void>(url: string) => request<T>('DELETE', url);

export interface SaleResult {
  card: CardDetail;
  sale: Sale;
  still_listed: Listing[];
}

export interface BulkResult {
  ok: number;
  failed: { id: number; error: string }[];
}

export type AiJobWithCard = AiJob & { card?: CardSummary };

export const api = {
  session: () => get<SessionInfo>('/api/auth/session'),
  login: (password: string) => post<SessionInfo>('/api/auth/login', { password }),
  logout: () => post<SessionInfo>('/api/auth/logout'),

  cards: (params: Params) => get<CardListResponse>(`/api/cards${qs(params)}`),
  facets: () => get<CardFacets>('/api/cards/facets'),
  card: (id: number) => get<CardDetail>(`/api/cards/${id}`),
  createCard: (form: FormData) => post<CardDetail>('/api/cards', form),
  updateCard: (id: number, patchBody: Record<string, unknown>) => patch<CardDetail>(`/api/cards/${id}`, patchBody),
  deleteCard: (id: number) => del(`/api/cards/${id}`),
  bulk: (ids: number[], action: string, value?: unknown) => post<BulkResult>('/api/cards/bulk', { ids, action, value }),

  uploadImage: (id: number, side: 'front' | 'back' | 'extra', file: Blob, replace = true) => {
    const form = new FormData();
    form.append('side', side);
    form.append('replace', replace ? '1' : '0');
    form.append('file', file, 'photo.jpg');
    return post<CardDetail>(`/api/cards/${id}/images`, form);
  },
  deleteImage: (id: number, imageId: number) => del<CardDetail>(`/api/cards/${id}/images/${imageId}`),
  rotateImage: (id: number, imageId: number, degrees: 90 | 180 | 270) =>
    post<CardDetail>(`/api/cards/${id}/images/${imageId}/rotate`, { degrees }),
  swapImages: (id: number) => post<CardDetail>(`/api/cards/${id}/images/swap`),

  identify: (id: number, opts: { overwrite?: boolean; then_price?: boolean } = {}) =>
    post<CardDetail>(`/api/cards/${id}/identify`, opts),
  research: (id: number) => post<CardDetail>(`/api/cards/${id}/research`),

  addListing: (cardId: number, body: Record<string, unknown>) => post<CardDetail>(`/api/cards/${cardId}/listings`, body),
  updateListing: (id: number, body: Record<string, unknown>) => patch<CardDetail>(`/api/listings/${id}`, body),
  deleteListing: (id: number) => del<CardDetail>(`/api/listings/${id}`),
  endListings: (ids: number[]) => post<{ ended: number }>('/api/listings/end', { ids }),

  inquiries: (params: Params) => get<{ inquiries: Inquiry[]; total: number }>(`/api/inquiries${qs(params)}`),
  addInquiry: (cardId: number, body: Record<string, unknown>) => post<CardDetail>(`/api/cards/${cardId}/inquiries`, body),
  updateInquiry: (id: number, body: Record<string, unknown>) => patch<Inquiry>(`/api/inquiries/${id}`, body),
  deleteInquiry: (id: number) => del(`/api/inquiries/${id}`),

  sales: (params: Params) =>
    get<{
      sales: Sale[];
      total: number;
      totals: { gross_cents: number; fees_cents: number; net_cents: number; count: number };
    }>(`/api/sales${qs(params)}`),
  addSale: (cardId: number, body: Record<string, unknown>) => post<SaleResult>(`/api/cards/${cardId}/sales`, body),
  updateSale: (id: number, body: Record<string, unknown>) => patch<Sale>(`/api/sales/${id}`, body),
  deleteSale: (id: number) => del(`/api/sales/${id}`),

  addPriceCheck: (cardId: number, body: Record<string, unknown>) =>
    post<CardDetail>(`/api/cards/${cardId}/price-checks`, body),
  deletePriceCheck: (id: number) => del(`/api/price-checks/${id}`),

  purchases: () => get<Purchase[]>('/api/purchases'),
  purchase: (id: number) => get<PurchaseDetail>(`/api/purchases/${id}`),
  createPurchase: (body: Record<string, unknown>) => post<Purchase>('/api/purchases', body),
  updatePurchase: (id: number, body: Record<string, unknown>) => patch<Purchase>(`/api/purchases/${id}`, body),
  deletePurchase: (id: number) => del(`/api/purchases/${id}`),
  assignCards: (id: number, cardIds: number[]) => post(`/api/purchases/${id}/cards`, { card_ids: cardIds }),
  unassignCards: (id: number, cardIds: number[]) => post(`/api/purchases/${id}/unassign`, { card_ids: cardIds }),
  allocate: (id: number, method: 'even' | 'by_value', apply: boolean) =>
    post<AllocationPreview>(`/api/purchases/${id}/allocate`, { method, apply }),

  platforms: () => get<Platform[]>('/api/platforms'),
  createPlatform: (body: Record<string, unknown>) => post<Platform>('/api/platforms', body),
  updatePlatform: (id: number, body: Record<string, unknown>) => patch<Platform>(`/api/platforms/${id}`, body),
  deletePlatform: (id: number) => del(`/api/platforms/${id}`),

  settings: () => get<Settings>('/api/settings'),
  updateSettings: (body: Partial<Settings>) => patch<Settings>('/api/settings', body),
  navCounts: () => get<NavCounts>('/api/nav-counts'),
  system: () => get<{ storage_warning: string | null }>('/api/system'),
  aiStatus: () => get<AiStatus>('/api/ai/status'),
  aiJobs: () => get<AiJobWithCard[]>('/api/ai/jobs'),
  retryFailed: () => post<{ retried: number }>('/api/ai/retry-failed'),
  cancelQueued: () => post<{ cancelled: number }>('/api/ai/cancel-queued'),

  dashboard: (params: Params) => get<Dashboard>(`/api/dashboard${qs(params)}`),
  pnl: (params: Params) => get<PnlReport>(`/api/reports/pnl${qs(params)}`),

  public: {
    store: () => get<PublicStore>('/api/public/store'),
    cards: (params: Params) => get<PublicCardList>(`/api/public/cards${qs(params)}`),
    card: (sku: string) => get<PublicCard>(`/api/public/cards/${encodeURIComponent(sku)}`),
    inquire: (sku: string, body: Record<string, unknown>) =>
      post<{ ok: true }>(`/api/public/cards/${encodeURIComponent(sku)}/inquiries`, body),
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return 'Something went wrong';
}
