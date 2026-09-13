'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Save, Send, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { SecretCredentialField, EMPTY_SECRET, type SecretCredentialValue } from '@/components/secret-credential-field';

export function EmailTab() {
  const [s, setS] = useState<any>({ enabled: false, host: '', port: 587, secure: false, username: '', fromName: '', fromEmail: '', replyTo: '', hasPassword: false });
  const [cred, setCred] = useState<SecretCredentialValue>(EMPTY_SECRET);
  const [encAvailable, setEncAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');

  const load = () => {
    fetch('/api/settings/email')
      .then((r) => r.json())
      .then((d) => {
        setEncAvailable(!!d.encryptionAvailable);
        if (d.settings) setS({ ...d.settings });
      })
      .catch(() => toast.error('Failed to load email settings'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const set = (k: string, v: any) => setS((p: any) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...s, password: cred.password || undefined, clearPassword: cred.clear || undefined }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'save failed');
      }
      setCred(EMPTY_SECRET);
      toast.success('Email settings saved');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/settings/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testTo || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || 'send failed');
      toast.success('Test email sent');
    } catch (e: any) {
      toast.error(e.message || 'Failed to send test email');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground p-6"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>;

  return (
    <div className="space-y-6">
      {encAvailable ? (
        <Alert>
          <ShieldCheck className="w-4 h-4" />
          <AlertTitle>Encryption available</AlertTitle>
          <AlertDescription>The SMTP password is encrypted at rest with AES-256-GCM using the server encryption key.</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <ShieldAlert className="w-4 h-4" />
          <AlertTitle>Encryption key missing</AlertTitle>
          <AlertDescription>APP_ENCRYPTION_KEY is not configured. Saving an SMTP password is disabled until the key is set on the server (fail-closed). Contact your administrator.</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>SMTP / Email Delivery</CardTitle>
          <CardDescription>Configure the outbound mail server used to send invoices and notifications.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={!!s.enabled} onCheckedChange={(v: boolean) => set('enabled', v)} />
            <Label>Email sending enabled</Label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1"><Label>SMTP Host</Label><Input value={s.host ?? ''} placeholder="smtp.example.com" onChange={(e: any) => set('host', e.target.value)} /></div>
            <div className="space-y-1"><Label>Port</Label><Input type="number" value={s.port ?? ''} placeholder="587" onChange={(e: any) => set('port', e.target.value)} /></div>
            <div className="flex items-center gap-3"><Switch checked={!!s.secure} onCheckedChange={(v: boolean) => set('secure', v)} /><Label>Use TLS/SSL (secure)</Label></div>
            <div className="space-y-1"><Label>Username</Label><Input value={s.username ?? ''} onChange={(e: any) => set('username', e.target.value)} /></div>
            <div className="space-y-1">
              <SecretCredentialField
                label="Password"
                configured={!!s.hasPassword}
                disabled={!encAvailable}
                disabledReason="APP_ENCRYPTION_KEY is not configured on the server"
                value={cred}
                onChange={setCred}
              />
            </div>
            <div className="space-y-1"><Label>From Name</Label><Input value={s.fromName ?? ''} onChange={(e: any) => set('fromName', e.target.value)} /></div>
            <div className="space-y-1"><Label>From Email</Label><Input value={s.fromEmail ?? ''} placeholder="noreply@example.com" onChange={(e: any) => set('fromEmail', e.target.value)} /></div>
            <div className="space-y-1"><Label>Reply-To</Label><Input value={s.replyTo ?? ''} onChange={(e: any) => set('replyTo', e.target.value)} /></div>
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save Email Settings
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Send Test Email</CardTitle>
          <CardDescription>Sends a test message using the saved settings to verify delivery.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="space-y-1 flex-1"><Label>Recipient (defaults to your account email)</Label><Input value={testTo} placeholder="you@example.com" onChange={(e: any) => setTestTo(e.target.value)} /></div>
            <Button onClick={sendTest} disabled={testing} variant="secondary">
              {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}Send Test
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
