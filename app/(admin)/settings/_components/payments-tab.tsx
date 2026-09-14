'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, PlugZap, ShieldAlert, CheckCircle2, XCircle, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils/format';

export function PaymentsTab() {
  const [s, setS] = useState<any>({ enabled: false, environment: 'SANDBOX', merchantId: '', terminalId: '', cardEnabled: true, achEnabled: false, tokenizationEnabled: false, hasApiUsername: false, hasApiPassword: false });
  const [apiUsername, setApiUsername] = useState('');
  const [apiPassword, setApiPassword] = useState('');
  const [encAvailable, setEncAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = () => fetch('/api/payment-settings')
    .then((r) => r.json())
    .then((d) => { setEncAvailable(!!d.encryptionAvailable); if (d.settings) setS((p: any) => ({ ...p, ...d.settings })); })
    .catch(() => toast.error('Failed to load payment settings'))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const set = (k: string, v: any) => setS((p: any) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/payment-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...s, apiUsername: apiUsername || undefined, apiPassword: apiPassword || undefined }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Save failed'); }
      setApiUsername(''); setApiPassword('');
      await load();
      toast.success('Payment settings saved');
    } catch (e: any) { toast.error(e.message || 'Save failed'); } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/payment-settings/test', { method: 'POST' });
      const d = await res.json();
      if (d.ok) toast.success('Gateway reachable (sandbox)'); else toast.error(d.responseText || 'Connection failed');
      await load();
    } catch { toast.error('Test failed'); } finally { setTesting(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {!encAvailable && (
        <Alert variant="destructive"><ShieldAlert className="w-4 h-4" /><AlertTitle>Encryption key missing</AlertTitle>
          <AlertDescription>APP_ENCRYPTION_KEY is not configured. Credentials cannot be stored until it is set.</AlertDescription></Alert>
      )}
      <Alert><CreditCard className="w-4 h-4" /><AlertTitle>Sandbox only</AlertTitle>
        <AlertDescription>Live/production charging is disabled in this release. Only the IPPay sandbox gateway (testgtwy.ippay.com) is used.</AlertDescription></Alert>

      <Card>
        <CardHeader><CardTitle>IPPay Connection</CardTitle><CardDescription>Provider abstraction — IPPay XML gateway. Secrets are encrypted at rest and never returned to the browser.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div><Label>Enabled</Label><p className="text-sm text-muted-foreground">Allow PAY NOW and API payments.</p></div>
            <Switch checked={s.enabled} onCheckedChange={(v) => set('enabled', v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>Environment</Label><Input value="SANDBOX" disabled /><p className="text-xs text-muted-foreground mt-1">Locked to sandbox in this release.</p></div>
            <div><Label htmlFor="mid">Merchant Identifier</Label><Input id="mid" value={s.merchantId || ''} onChange={(e) => set('merchantId', e.target.value)} /></div>
            <div><Label htmlFor="tid">Terminal Identifier</Label><Input id="tid" value={s.terminalId || ''} onChange={(e) => set('terminalId', e.target.value)} /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="au">API Username {s.hasApiUsername && <Badge variant="secondary" className="ml-2">configured</Badge>}</Label>
              <Input id="au" type="password" autoComplete="off" placeholder={s.hasApiUsername ? '•••••• (unchanged)' : ''} value={apiUsername} onChange={(e) => setApiUsername(e.target.value)} /></div>
            <div><Label htmlFor="ap">API Credential {s.hasApiPassword && <Badge variant="secondary" className="ml-2">configured</Badge>}</Label>
              <Input id="ap" type="password" autoComplete="off" placeholder={s.hasApiPassword ? '•••••• (unchanged)' : ''} value={apiPassword} onChange={(e) => setApiPassword(e.target.value)} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-lg border p-3"><Label>Card</Label><Switch checked={s.cardEnabled} onCheckedChange={(v) => set('cardEnabled', v)} /></div>
            <div className="flex items-center justify-between rounded-lg border p-3"><Label>ACH</Label><Switch checked={s.achEnabled} onCheckedChange={(v) => set('achEnabled', v)} /></div>
            <div className="flex items-center justify-between rounded-lg border p-3"><Label>Tokenization</Label><Switch checked={s.tokenizationEnabled} onCheckedChange={(v) => set('tokenizationEnabled', v)} /></div>
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save</Button>
            <Button variant="outline" onClick={test} disabled={testing}>{testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlugZap className="w-4 h-4 mr-2" />}Test Connection</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Connection Status</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">Status:
            {s.lastConnectionStatus === 'OK' ? <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 className="w-4 h-4" />OK</span>
              : s.lastConnectionStatus === 'FAILED' ? <span className="inline-flex items-center gap-1 text-destructive"><XCircle className="w-4 h-4" />Failed</span>
              : <Badge variant="secondary">Untested</Badge>}</div>
          <div className="text-muted-foreground">Last successful: {s.lastSuccessAt ? formatDate(s.lastSuccessAt) : '—'}</div>
          <div className="text-muted-foreground">Last failed: {s.lastFailureAt ? formatDate(s.lastFailureAt) : '—'}</div>
          {s.lastFailureMessage && <div className="text-destructive">{s.lastFailureMessage}</div>}
        </CardContent>
      </Card>
    </div>
  );
}
