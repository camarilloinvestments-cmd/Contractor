'use client';
import { signOut } from 'next-auth/react';
import { Cable, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export function PortalHeader({ user }: { user: { name: string; role: string } }) {
  return (
    <header className="sticky top-0 z-50 bg-primary text-primary-foreground shadow-md">
      <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/portal" className="flex items-center gap-2">
          <Cable className="w-6 h-6" />
          <span className="font-display font-bold">FiberTrack</span>
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-sm">
            <User className="w-4 h-4" />
            <span className="hidden sm:inline">{user?.name ?? 'Worker'}</span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-primary-foreground hover:bg-white/20"
            onClick={() => signOut({ redirectTo: '/login' })}
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
