'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  LayoutDashboard, Building2, Briefcase, Wrench, Users, FileText,
  DollarSign, BarChart3, Settings, LogOut, Cable, ChevronLeft, ChevronRight, HardHat, Coins, TrendingUp,
  Map, Route, DownloadCloud, ClipboardCheck, TabletSmartphone, FileEdit, FileCheck2, Receipt, ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type Role = 'ADMIN' | 'PROJECT_MANAGER' | 'FIELD_WORKER';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[]; // if omitted, visible to all admin-area roles
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const dashboardItem: NavItem = { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard };

const navGroups: NavGroup[] = [
  {
    id: 'work',
    label: 'Work',
    items: [
      { href: '/prime-contractors', label: 'Prime Contractors', icon: Building2 },
      { href: '/jobs', label: 'Jobs / Work Orders', icon: Briefcase },
      { href: '/task-types', label: 'Task Types', icon: Wrench },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { href: '/workers', label: 'Workers', icon: HardHat },
      { href: '/users', label: 'Users', icon: Users, roles: ['ADMIN'] },
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    items: [
      { href: '/estimates', label: 'Estimates', icon: FileEdit },
      { href: '/quotes', label: 'Quotes', icon: FileCheck2 },
      { href: '/invoices', label: 'Invoices', icon: FileText },
      { href: '/statements', label: 'Statements', icon: Receipt },
    ],
  },
  {
    id: 'financials',
    label: 'Financials',
    items: [
      { href: '/payouts', label: 'Payouts', icon: DollarSign },
      { href: '/rate-books', label: 'Rate Books', icon: Coins, roles: ['ADMIN', 'PROJECT_MANAGER'] },
      { href: '/sales', label: 'Sales / Commissions', icon: TrendingUp, roles: ['ADMIN', 'PROJECT_MANAGER'] },
      { href: '/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { href: '/operations/live-map', label: 'Live Map', icon: Map, roles: ['ADMIN', 'PROJECT_MANAGER'] },
      { href: '/operations/fleet/vehicle-history', label: 'Vehicle History', icon: Route, roles: ['ADMIN', 'PROJECT_MANAGER'] },
      { href: '/evidence', label: 'Evidence Review', icon: ClipboardCheck, roles: ['ADMIN', 'PROJECT_MANAGER'] },
      { href: '/system/devices', label: 'Device Management', icon: TabletSmartphone, roles: ['ADMIN'] },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { href: '/system/updates', label: 'System Updates', icon: DownloadCloud, roles: ['ADMIN'] },
      { href: '/settings', label: 'Settings', icon: Settings, roles: ['ADMIN'] },
    ],
  },
];

const STORAGE_KEY = 'os1.sidebar.groups';

function itemVisible(item: NavItem, role: Role): boolean {
  if (!item.roles) return true;
  return item.roles.includes(role);
}

export function AdminSidebar({
  user,
  companyName = 'OS1 Fiber Track Pro',
  productName = 'OS1 Fiber Track Pro',
  appVersion,
}: {
  user: { name: string; email: string; role: string };
  companyName?: string;
  productName?: string;
  appVersion?: string;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const role = (user?.role as Role) ?? 'FIELD_WORKER';

  // Groups this operator can actually see (at least one visible item)
  const visibleGroups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((it) => itemVisible(it, role)) }))
    .filter((g) => g.items.length > 0);

  const isItemActive = (href: string) =>
    pathname === href || (pathname?.startsWith(href + '/') ?? false);

  // Open/closed state per group, persisted to localStorage. Default: all open.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const g of navGroups) initial[g.id] = true;
    return initial;
  });
  const [hydrated, setHydrated] = useState(false);

  // Load persisted preference once on mount.
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        setOpenGroups((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      /* ignore malformed preference */
    }
    setHydrated(true);
  }, []);

  // Persist preference after hydration.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(openGroups));
    } catch {
      /* storage unavailable */
    }
  }, [openGroups, hydrated]);

  // Auto-open the group that owns the active route.
  useEffect(() => {
    const activeGroup = navGroups.find((g) => g.items.some((it) => isItemActive(it.href)));
    if (activeGroup) {
      setOpenGroups((prev) => (prev[activeGroup.id] ? prev : { ...prev, [activeGroup.id]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  const dashboardActive = isItemActive(dashboardItem.href);
  const DashIcon = dashboardItem.icon;

  return (
    <aside
      className={cn(
        'flex flex-col bg-slate-900 text-white transition-all duration-normal h-screen',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex items-center gap-3 p-4 border-b border-slate-700 flex-shrink-0">
        <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
          <Cable className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="text-base font-display font-bold tracking-tight truncate">{companyName}</h1>
          </div>
        )}
      </div>

      <nav className="flex-1 py-3 overflow-y-auto" aria-label="Primary">
        {/* Dashboard (standalone) */}
        <Link
          href={dashboardItem.href}
          aria-current={dashboardActive ? 'page' : undefined}
          title={collapsed ? dashboardItem.label : undefined}
          className={cn(
            'flex items-center gap-3 px-3 py-2 mx-2 rounded-lg text-sm transition-colors',
            collapsed && 'justify-center',
            dashboardActive
              ? 'bg-primary/20 text-white font-medium ring-1 ring-primary/40'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          )}
        >
          <DashIcon className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>{dashboardItem.label}</span>}
        </Link>

        {collapsed ? (
          // Icon-only mode: flat list with per-group dividers, no headers.
          <div className="mt-2">
            {visibleGroups.map((group) => (
              <div key={group.id} className="mt-2 pt-2 border-t border-slate-800 first:border-t-0">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isItemActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={item.label}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center justify-center px-3 py-2 mx-2 rounded-lg text-sm transition-colors',
                        active
                          ? 'bg-primary/20 text-white ring-1 ring-primary/40'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      )}
                    >
                      <Icon className="w-5 h-5 flex-shrink-0" />
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          // Expanded mode: collapsible groups.
          <div className="mt-2 space-y-1">
            {visibleGroups.map((group) => {
              const open = openGroups[group.id] ?? true;
              const groupHasActive = group.items.some((it) => isItemActive(it.href));
              return (
                <div key={group.id}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={open}
                    aria-controls={`navgroup-${group.id}`}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-1.5 mx-2 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors',
                      'w-[calc(100%-1rem)]',
                      groupHasActive ? 'text-slate-200' : 'text-slate-400 hover:text-slate-200'
                    )}
                  >
                    <span>{group.label}</span>
                    <ChevronDown
                      className={cn('w-3.5 h-3.5 transition-transform', !open && '-rotate-90')}
                    />
                  </button>
                  <div
                    id={`navgroup-${group.id}`}
                    hidden={!open}
                    className="mt-0.5"
                  >
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = isItemActive(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-3 pl-6 pr-3 py-2 mx-2 rounded-lg text-sm transition-colors',
                            active
                              ? 'bg-primary/20 text-white font-medium ring-1 ring-primary/40'
                              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          )}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </nav>

      <div className="border-t border-slate-700 p-4 flex-shrink-0">
        {!collapsed && (
          <div className="mb-3">
            <p className="text-sm font-medium truncate">{user?.name ?? 'User'}</p>
            <p className="text-xs text-slate-400 truncate">{user?.role ?? ''}</p>
            {appVersion && <p className="text-[10px] text-slate-500 mt-1 font-mono">{productName} v{appVersion}</p>}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="text-slate-400 hover:text-white hover:bg-slate-800"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
          {!collapsed && (
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-white hover:bg-slate-800 flex-1"
              onClick={() => signOut({ redirectTo: '/login' })}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
