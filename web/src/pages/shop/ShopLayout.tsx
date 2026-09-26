import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Mail, MapPin, Phone, Store } from 'lucide-react';
import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useOutletContext, useSearchParams } from 'react-router';
import type { PublicStore } from '@shared/types';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Alert, PageSpinner } from '../../components/ui/Feedback';
import { api, errorMessage } from '../../lib/api';
import { FormatProvider } from '../../lib/format';

export function useStore(): PublicStore {
  return useOutletContext<PublicStore>();
}

export function ShopLayout() {
  const store = useQuery({ queryKey: ['public-store'], queryFn: api.public.store, staleTime: 60_000 });
  const [params] = useSearchParams();
  const location = useLocation();
  const activeCategory = params.get('category') ?? '';

  useEffect(() => {
    if (store.data) document.title = `${store.data.name} — ${store.data.tagline || 'Trading cards'}`;
  }, [store.data]);

  if (store.isLoading) return <PageSpinner />;
  if (store.error || !store.data) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <Alert tone="critical" title="The shop couldn’t load">
          {errorMessage(store.error)}
        </Alert>
      </div>
    );
  }
  const s = store.data;

  if (!s.enabled) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <Store className="size-10 text-muted" />
        <h1 className="text-2xl font-semibold">{s.name}</h1>
        <p className="text-ink-2">The shop is closed right now. Please check back soon.</p>
        {s.contact_email && (
          <a href={`mailto:${s.contact_email}`} className="text-primary hover:underline">
            {s.contact_email}
          </a>
        )}
        <Link to="/admin" className="mt-6 text-xs text-muted hover:text-ink">
          Owner sign-in
        </Link>
      </div>
    );
  }

  return (
    <FormatProvider currency={s.currency} locale={s.locale}>
      <div className="flex min-h-dvh flex-col">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
            <Link to="/" className="flex items-center gap-3">
              <img src="/favicon.svg" alt="" className="size-10" />
              <div className="leading-tight">
                <div className="text-lg font-semibold tracking-tight">{s.name}</div>
                {s.tagline && <div className="text-sm text-muted">{s.tagline}</div>}
              </div>
            </Link>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
              {s.pickup_location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4" /> {s.pickup_location}
                </span>
              )}
              {s.contact_email && (
                <a href={`mailto:${s.contact_email}`} className="inline-flex items-center gap-1.5 hover:text-primary">
                  <Mail className="size-4" /> {s.contact_email}
                </a>
              )}
            </div>
          </div>
          {s.categories.length > 1 && (
            <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-3" aria-label="Categories">
              <NavLink
                to="/"
                end
                className={() =>
                  clsx('shrink-0 rounded-full px-3 py-1.5 text-sm font-medium', !activeCategory ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-surface-3')
                }
              >
                All cards
              </NavLink>
              {s.categories.map((c) => (
                <Link
                  key={c.name}
                  to={`/?category=${encodeURIComponent(c.name)}`}
                  className={clsx(
                    'shrink-0 rounded-full px-3 py-1.5 text-sm font-medium',
                    activeCategory === c.name ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-surface-3',
                  )}
                >
                  {c.name} <span className="text-xs opacity-70">{c.count}</span>
                </Link>
              ))}
            </nav>
          )}
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet context={s} />
          </ErrorBoundary>
        </main>
        <footer className="border-t border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted">
            <div>
              © {new Date().getFullYear()} {s.name}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {s.contact_phone && (
                <a href={`tel:${s.contact_phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                  <Phone className="size-4" /> {s.contact_phone}
                </a>
              )}
              {s.contact_email && (
                <a href={`mailto:${s.contact_email}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                  <Mail className="size-4" /> {s.contact_email}
                </a>
              )}
              <Link to="/admin" className="text-xs hover:text-ink">
                Owner sign-in
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </FormatProvider>
  );
}
