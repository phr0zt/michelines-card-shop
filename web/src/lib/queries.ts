import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CardDetail } from '@shared/types';
import { api } from './api';

export const qk = {
  settings: ['settings'] as const,
  platforms: ['platforms'] as const,
  facets: ['facets'] as const,
  navCounts: ['nav-counts'] as const,
  aiStatus: ['ai-status'] as const,
  aiJobs: ['ai-jobs'] as const,
  purchases: ['purchases'] as const,
  card: (id: number) => ['card', id] as const,
};

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.settings, staleTime: 5 * 60_000 });
}

export function usePlatforms() {
  return useQuery({ queryKey: qk.platforms, queryFn: api.platforms, staleTime: 5 * 60_000 });
}

export function useFacets() {
  return useQuery({ queryKey: qk.facets, queryFn: api.facets, staleTime: 60_000 });
}

export function useNavCounts() {
  return useQuery({ queryKey: qk.navCounts, queryFn: api.navCounts, refetchInterval: 20_000 });
}

export function useAiStatus() {
  return useQuery({ queryKey: qk.aiStatus, queryFn: api.aiStatus, staleTime: 30_000 });
}

export function usePurchases() {
  return useQuery({ queryKey: qk.purchases, queryFn: api.purchases, staleTime: 60_000 });
}

/** After any change that returns a fresh card, store it and refresh everything derived from cards. */
export function useApplyCard() {
  const qc = useQueryClient();
  return (detail?: CardDetail | null) => {
    if (detail && typeof detail === 'object' && 'id' in detail) qc.setQueryData(qk.card(detail.id), detail);
    invalidateCardLists(qc);
  };
}

export function invalidateCardLists(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['cards', 'nav-counts', 'dashboard', 'inquiries', 'sales', 'facets', 'purchase', 'purchases', 'reports', 'ai-jobs']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}
