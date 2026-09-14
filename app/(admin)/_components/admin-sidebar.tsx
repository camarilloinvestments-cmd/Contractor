'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  LayoutDashboard, Building2, Briefcase, Wrench, Users, FileText,
  DollarSign, BarChart3, Settings, LogOut, Cable, ChevronLeft, ChevronRight, HardHat, Coins
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const baseNavItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/prime-contractors', label: 'Prime Contractors', icon: Building2 },
  { href: '/jobs', label: 'Jobs / Work Orders', icon: Briefcase },
  { href: '/task-types', label: 'Task Types', icon: Wrench },
  { href: '/workers', label: 'Workers', icon: HardHat },
  { href: '/invoices', label: 'Invoices', icon: FileText },
  { href: '/payouts', label: 'Payouts', icon: DollarSign },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/users', label: 'Users', icon: Users },
];

const managerNavItems = [
  { href: '/rate-books', label: 'Rate Books', icon: Coins },
];

const adminNavItems = [
  { href: '/settings', label: 'Settings', icon: Settings },
];

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
  const isManager = user?.role === 'ADMIN' || user?.role === 'PROJECT_MANAGER';
  const navItems = user?.role === 'ADMIN'
    ? [...baseNavItems, ...managerNavItems, ...adminNavItems]
    : isManager
      ? [...baseNavItems, ...managerNavItems]
      : baseNavItems;

  return (
    <aside className={cn(
      'flex flex-col bg-slate-900 text-white transition-all duration-normal h-screen',
      collapsed ? 'w-16' : 'w-64'
    )}>
      <div className="flex items-center gap-3 p-4 border-b border-slate-700">
        <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
          <Cable className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="text-base font-display font-bold tracking-tight truncate">{companyName}</h1>
          </div>
        )}
      </div>

      <nav className="flex-1 py-4 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-primary/20 text-primary-foreground font-medium'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-700 p-4">
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
