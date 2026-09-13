'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ShieldCheck, Copy, Download, Check } from 'lucide-react';

type Step = 'intro' | 'scan' | 'codes';

export function EnrollForm({ required, dest }: { required: boolean; dest: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('intro');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/mfa/enroll/start', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? 'Could not start enrollment');
      setQr(d.qr);
      setManualKey(d.manualKey);
      setStep('scan');
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not start enrollment');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.trim().length < 6) return toast.error('Enter the 6-digit code from your authenticator app');
    setBusy(true);
    try {
      const res = await fetch('/api/mfa/enroll/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? 'Verification failed');
      setRecoveryCodes(d.recoveryCodes ?? []);
      setStep('codes');
      toast.success('Two-factor authentication enabled');
    } catch (err: any) {
      toast.error(err?.message ?? 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      toast.success('Recovery codes copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const downloadCodes = () => {
    const blob = new Blob([recoveryCodes.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const finish = () => {
    router.replace(dest);
    router.refresh();
  };

  if (step === 'intro') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" /> Set up two-factor authentication</CardTitle>
          <CardDescription>
            You&apos;ll need an authenticator app such as Google Authenticator, Microsoft Authenticator, or Authy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
            <li>Install an authenticator app on your phone.</li>
            <li>Scan the QR code we&apos;ll show you next.</li>
            <li>Enter the 6-digit code to confirm.</li>
            <li>Save your one-time recovery codes.</li>
          </ol>
          <Button onClick={start} disabled={busy} className="w-full">
            {busy ? 'Preparing...' : 'Begin setup'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step === 'scan') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scan the QR code</CardTitle>
          <CardDescription>Scan with your authenticator app, then enter the current 6-digit code.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {qr && (
            <div className="flex justify-center">
              <div className="relative w-48 h-48 bg-white p-2 rounded-lg border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="Two-factor authentication QR code" className="w-full h-full" />
              </div>
            </div>
          )}
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-1">Can&apos;t scan? Enter this key manually:</p>
            <code className="text-xs font-mono break-all bg-muted px-2 py-1 rounded">{manualKey}</code>
          </div>
          <div>
            <Label>Authentication code</Label>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e: any) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-center tracking-[0.5em] font-mono text-lg"
            />
          </div>
          <Button onClick={verify} disabled={busy} className="w-full">
            {busy ? 'Verifying...' : 'Verify & enable'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Check className="w-5 h-5 text-green-600" /> Save your recovery codes</CardTitle>
        <CardDescription>
          Store these somewhere safe. Each code works once if you lose access to your authenticator. They won&apos;t be shown again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 bg-muted rounded-lg p-3">
          {recoveryCodes.map((c) => (
            <code key={c} className="text-sm font-mono text-center py-1">{c}</code>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={copyCodes} className="flex-1"><Copy className="w-4 h-4 mr-2" /> Copy</Button>
          <Button variant="outline" onClick={downloadCodes} className="flex-1"><Download className="w-4 h-4 mr-2" /> Download</Button>
        </div>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={savedConfirmed} onChange={(e) => setSavedConfirmed(e.target.checked)} className="mt-1" />
          <span>I have saved my recovery codes in a safe place.</span>
        </label>
        <Button onClick={finish} disabled={!savedConfirmed} className="w-full">Continue</Button>
      </CardContent>
    </Card>
  );
}
