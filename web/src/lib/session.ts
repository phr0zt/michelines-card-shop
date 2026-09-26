import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './api';

export function useSession() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['session'], queryFn: api.session, staleTime: 60_000 });
  useEffect(() => {
    const onExpired = () => void qc.invalidateQueries({ queryKey: ['session'] });
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [qc]);
  return query;
}
