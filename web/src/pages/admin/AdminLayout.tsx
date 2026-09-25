import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BarChart3,
  Camera,
  ClipboardCheck,
  ExternalLink,
  LayoutDashboard,
  Library,
  LogOut,
  Menu as MenuIcon,
  MessagesSquare,
  Moon,
  Package,
  Receipt,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { ButtonLink } from '../../components/ui/Button';
import { PageSpinner } from '../../components/ui/Feedback';
import { api } from '../../lib/api';
import { FormatProvider } from '../../lib/format';
import { useNavCounts, useSettings } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { applyTheme, isDarkNow } from '../../lib/theme';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  count?: number;
  alert?: boolean;
}

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Admin">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-primary-soft text-primary' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
            )
          }
        >
          <span className="[&_svg]:size-4.5">{item.icon}</span>
          <span className="flex-1">{item.label}</span>
          {item.count ? (
            <span
              className={clsx(
                'tabular min-w-5 rounded-full px-1.5 text-center text-xs font-semibold',
                item.alert ? 'bg-critical text-white' : 'bg-surface-3 text-ink-2',
              )}
            >
              {item.count}
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AdminLayout() {
  const session = useSession();
  const location = useLocation();

  if (session.isLoading) return <PageSpinner />;
  if (!session.data?.authenticated) {
    return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <AdminShell />;
}

function AdminShell() {
  const settings = useSettings();
  const counts = useNavCounts().data;
  const [drawer, setDrawer] = useState(false);
  const [dark, setDark] = useState(isDarkNow());
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  useEffect(() => setDrawer(false), [location.pathname]);

  const inquiriesNeedingAttention = (counts?.inquiries_new ?? 0) + (counts?.inquiries_due ?? 0);
  const items: NavItem[] = [
    { to: '/admin', label: 'Dashboard', icon: <LayoutDashboard />, end: true, count: counts?.sold_still_listed, alert: true },
    { to: '/admin/cards', label: 'Inventory', icon: <Library /> },
    { to: '/admin/cards/new', label: 'Add cards', icon: <Camera /> },
    { to: '/admin/review', label: 'Review', icon: <ClipboardCheck />, count: counts?.drafts },
    { to: '/admin/inquiries', label: 'Inquiries', icon: <MessagesSquare />, count: inquiriesNeedingAttention },
    { to: '/admin/sales', label: 'Sales', icon: <Receipt />, count: counts?.to_ship },
    { to: '/admin/purchases', label: 'Purchases', icon: <Package /> },
    { to: '/admin/reports', label: 'Reports', icon: <BarChart3 /> },
    { to: '/admin/settings', label: 'Settings', icon: <SettingsIcon /> },
  ];
  // "Add cards" is also under Inventory's path, so only highlight it on its own page.
  items[1].end = true;

  const aiBusy = (counts?.ai_queued ?? 0) + (counts?.ai_running ?? 0);
  const storeName = settings.data?.store_name ?? 'Card Shop';

  useEffect(() => {
    document.title = `${storeName} · Admin`;
  }, [storeName]);

  async function logout() {
    await api.logout();
    qc.clear();
    navigate('/admin/login');
  }

  function toggleTheme() {
    const next = !dark;
    applyTheme(next ? 'dark' : 'light');
    setDark(next);
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    navigate(`/admin/cards${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`);
  }

  const sidebarFooter = (
    <div className="flex flex-col gap-0.5 border-t border-line pt-3">
      <a
        href="/"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-surface-3 hover:text-ink"
      >
        <ExternalLink className="size-4.5" /> View the shop
      </a>
      <button
        type="button"
        onClick={toggleTheme}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink-2 hover:bg-surface-3 hover:text-ink"
      >
        {dark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />} {dark ? 'Light mode' : 'Dark mode'}
      </button>
      <button
        type="button"
        onClick={logout}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink-2 hover:bg-surface-3 hover:text-ink"
      >
        <LogOut className="size-4.5" /> Sign out
      </button>
    </div>
  );

  const brand = (
    <Link to="/admin" className="flex items-center gap-2.5 px-2">
      <img src="/favicon.svg" alt="" className="size-8" />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold">{storeName}</div>
        <div className="text-xs text-muted">Inventory & sales</div>
      </div>
    </Link>
  );

  return (
    <FormatProvider currency={settings.data?.currency ?? 'CAD'} locale={settings.data?.locale ?? 'en-CA'}>
      <div className="min-h-dvh lg:pl-64">
        {/* Desktop sidebar */}
        <aside className="no-print fixed inset-y-0 left-0 hidden w-64 flex-col gap-4 border-r border-line bg-surface px-3 py-4 lg:flex">
          {brand}
          <div className="flex-1 overflow-y-auto">
            <NavLinks items={items} />
          </div>
          {sidebarFooter}
        </aside>

        {/* Mobile drawer */}
        {drawer && (
          <div className="no-print fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col gap-4 bg-surface px-3 py-4 shadow-pop">
              <div className="flex items-center justify-between">
                {brand}
                <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="rounded-lg p-2 text-muted hover:bg-surface-3">
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <NavLinks items={items} onNavigate={() => setDrawer(false)} />
              </div>
              {sidebarFooter}
            </aside>
          </div>
        )}

        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur sm:gap-3 sm:px-5">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawer(true)}
            className="rounded-lg p-2 text-ink-2 hover:bg-surface-3 lg:hidden"
          >
            <MenuIcon className="size-5" />
          </button>
          <form onSubmit={submitSearch} className="relative max-w-md flex-1" role="search">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cards — player, set, year, SKU, binder…"
              aria-label="Search cards"
              className="h-9 w-full rounded-lg border border-line bg-surface-2 pr-3 pl-9 text-sm focus:border-transparent focus:outline-2 focus:outline-[var(--focus)]"
            />
          </form>
          <div className="ml-auto flex items-center gap-2">
            {aiBusy > 0 && (
              <Link
                to="/admin/review"
                className="hidden items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary sm:inline-flex"
                title="AI is identifying cards or researching prices"
              >
                <Sparkles className="size-3.5 animate-pulse" />
                AI working on {aiBusy} {aiBusy === 1 ? 'task' : 'tasks'}
              </Link>
            )}
            <ButtonLink to="/admin/cards/new" variant="primary" size="sm" icon={<Camera className="size-4" />}>
              <span className="hidden sm:inline">Add cards</span>
            </ButtonLink>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>
      </div>
    </FormatProvider>
  );
}
