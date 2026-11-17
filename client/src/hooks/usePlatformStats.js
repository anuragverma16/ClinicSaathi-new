import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api.js';

/** Real, platform-wide numbers from the backend — no marketing-copy stats. */
export function usePlatformStats() {
  return useQuery({
    queryKey: ['public', 'stats'],
    queryFn: () => api.get('/public/stats').then(unwrap),
    staleTime: 5 * 60_000,
  });
}
