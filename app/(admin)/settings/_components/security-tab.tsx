'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { ShieldCheck, Copy, Download, Lock } from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrators',
  PROJECT_MANAGER: 'Project Managers',
  FIELD_WORKER: 'Field Workers',
};

export function SecurityTab() {
  const [policy, setPolicy] = useState<{ role: string; required: boolean }[]>([]);
  const [savingRole, setSavingRole] = useState<string | null>(null);

  // self-service
  const [status, setStatus] = useState<any>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCodes, setNewCodes] = useState<string[]>([]);

  const loadPolicy = () => {
    fetch('/api/settings/mfa-policy').then(r => r.json()).then(d => setPolicy(d?.policy ?? [])).catch(() => {});
  };
  const loadStatus = () => {
    fetch('/api/mfa/status').then(r => r.json()).then(setStatus).catch(() => {});
  };
  useEffect(() => { loadPolicy(); loadStatus(); }, []);

  const toggle = async (role: string, required: boolean) => {
    setSavingRole(role);
    try {
      const res = await fetch('/api/settings/mfa-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, required }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? 'Failed to update policy');
      setPolicy(d.policy ?? []);
      toast.success('Policy updated');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to update policy');
      loadPolicy();
    } finally {
      setSavingRole(null);
    }
  };

  const regenerate = async () => {
    if (code.trim().length < 6) return toast.error('Enter your current 6-digit authenticator code');
    setBusy(true);
    try {
      const res = await fetch('/api/mfa/recovery-codes/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? 'Failed to regenerate codes');
      setNewCodes(d.recoveryCodes ?? []);
      setCode('');
      loadStatus();
      toast.success('New recovery codes generated');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to regenerate codes');
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async () => {
    try { await navigator.clipboard.writeText(newCodes.join('\n')); toast.success('Copied'); } catch { toast.error('Could not copy'); }
  };
  const downloadCodes = () => {
    const blob = new Blob([newCodes.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'recovery-codes.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" /> Two-Factor Authentication Policy</CardTitle>
          <CardDescription>Require members of each role to set up an authenticator app. Administrators always require 2FA.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {policy.map((p) => {
            const locked = p.role === 'ADMIN';
            return (
              <div key={p.role} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="font-medium flex items-center gap-2">{ROLE_LABELS[p.role] ?? p.role}{locked && <Lock className="w-3.5 h-3.5 text-muted-foreground" />}</div>
                  <div className="text-xs text-muted-foreground">{p.required ? 'Required at next login' : 'Optional'}</div>
                </div>
                <Switch
                  checked={p.required}
                  disabled={locked || savingRole === p.role}
                  onCheckedChange={(v: boolean) => toggle(p.role, v)}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your Two-Factor Authentication</CardTitle>
          <CardDescription>
            {status?.mfaEnabled
              ? `Enabled. ${status?.recoveryCodesRemaining ?? 0} recovery code(s) remaining.`
              : 'Not enrolled yet.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!status?.mfaEnabled ? (
            <Button asChild><a href="/mfa/enroll">Set up two-factor authentication</a></Button>
          ) : newCodes.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Save these new recovery codes. Your old codes no longer work. They won&apos;t be shown again.</p>
              <div className="grid grid-cols-2 gap-2 bg-muted rounded-lg p-3">
                {newCodes.map((c) => <code key={c} className="text-sm font-mono text-center py-1">{c}</code>)}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={copyCodes} className="flex-1"><Copy className="w-4 h-4 mr-2" /> Copy</Button>
                <Button variant="outline" onClick={downloadCodes} className="flex-1"><Download className="w-4 h-4 mr-2" /> Download</Button>
              </div>
              <Button onClick={() => setNewCodes([])} className="w-full">Done</Button>
            </div>
          ) : (
            <div className="space-y-3 max-w-sm">
              <div>
                <Label>Regenerate recovery codes</Label>
                <p className="text-xs text-muted-foreground mb-2">Enter a current authenticator code to generate a fresh set. This invalidates your existing codes.</p>
                <Input
                  inputMode="numeric"
                  placeholder="000000"
                  value={code}
                  onChange={(e: any) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="text-center tracking-[0.4em] font-mono"
                />
              </div>
              <Button onClick={regenerate} disabled={busy}>{busy ? 'Working...' : 'Regenerate codes'}</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
