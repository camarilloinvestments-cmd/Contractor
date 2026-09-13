'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export function ChangePasswordForm({ forced, role }: { forced: boolean; role: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!current || !next) return toast.error('All fields are required');
    if (next.length < 8) return toast.error('New password must be at least 8 characters');
    if (next !== confirm) return toast.error('New passwords do not match');
    setSaving(true);
    try {
      const res = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? 'Failed to change password');
      toast.success('Password updated');
      const dest = role === 'FIELD_WORKER' ? '/portal' : '/dashboard';
      router.replace(dest);
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Change Password</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>Current Password</Label>
          <Input type="password" value={current} onChange={(e: any) => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
        <div>
          <Label>New Password</Label>
          <Input type="password" value={next} onChange={(e: any) => setNext(e.target.value)} autoComplete="new-password" />
        </div>
        <div>
          <Label>Confirm New Password</Label>
          <Input type="password" value={confirm} onChange={(e: any) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        <Button onClick={submit} disabled={saving} className="w-full">
          {saving ? 'Saving...' : 'Update Password'}
        </Button>
      </CardContent>
    </Card>
  );
}
