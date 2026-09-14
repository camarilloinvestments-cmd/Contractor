'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, PlugZap, ShieldAlert, CheckCircle2, XCircle, Truck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils/format';

export function IntegrationsTab() {
  const [s, setS] = useState<any>({ enabled: false, syncEnabled: false, database: '', username: '', serverUrl: '', hasCredential: false, lastConnectionStatus: 'UNTESTED' });
  const [credential, setCredential] = useState('');
  const [encAvailable, setEncAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = () => fetch('/api/fleet-settings')
    .then((r) => r.json())
    .then((d) => { setEncAvailable(!!d.encryptionAvailable); if (d.settings) setS((p: any) => ({ ...p, ...d.settings })); })
    .catch(() => toast.error('Failed to load Geotab settings'))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const set = (k: string, v: any) => setS((p: any) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/fleet-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...s, credential: credential || undefined }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Save failed'); }
      setCredential('');
      await load();
      toast.success('Geotab settings saved');
    } catch (e: any) { toast.error(e.message || 'Save failed'); } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/fleet-settings/test', { method: 'POST' });
      const d = await res.json();
      if (d.ok) toast.success('Geotab connection succeeded'); else toast.error(d.message || 'Connection failed');
      await load();
    } catch { toast.error('Test failed'); } finally { setTesting(false); }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/fleet/sync', { method: 'POST' });
      const d = await res.json();
      const su = d.summary || {};
      if (su.ok) toast.success(`Sync complete — ${su.vehiclesUpserted} vehicles, ${su.telemetryStored} telemetry rows, ${su.eventsCreated} geofence events`);
      else toast.error(su.message || 'Sync failed');
      await load();
    } catch { toast.error('Sync failed'); } finally { setSyncing(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {!encAvailable && (
        <Alert variant="destructive"><ShieldAlert className="w-4 h-4" /><AlertTitle>Encryption key missing</AlertTitle>
          <AlertDescription>APP_ENCRYPTION_KEY is not configured. The Geotab credential cannot be stored until it is set.</AlertDescription></Alert>
      )}
      <Alert><Truck className="w-4 h-4" /><AlertTitle>Geotab fleet telematics</AlertTitle>
        <AlertDescription>Connects to the official MyGeotab API server-side only. Credentials are encrypted at rest and never returned to the browser. Enter <span className="font-mono">MOCK</span> as the database to run against the built-in official-compatible fixture for testing.</AlertDescription></Alert>

      <Card>
        <CardHeader><CardTitle>Geotab Connection</CardTitle><CardDescription>MyGeotab API credentials. The credential is write-only — it is encrypted on save and never sent back.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div><Label>Enabled</Label><p className="text-sm text-muted-foreground">Activate the Geotab connector.</p></div>
            <Switch checked={s.enabled} onCheckedChange={(v) => set('enabled', v)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div><Label>Sync Enabled</Label><p className="text-sm text-muted-foreground">Allow scheduled/manual telemetry sync.</p></div>
            <Switch checked={s.syncEnabled} onCheckedChange={(v) => set('syncEnabled', v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="db">Database / Company</Label><Input id="db" value={s.database || ''} onChange={(e) => set('database', e.target.value)} placeholder="e.g. my_company (or MOCK)" /></div>
            <div><Label htmlFor="un">Username</Label><Input id="un" value={s.username || ''} onChange={(e) => set('username', e.target.value)} autoComplete="off" /></div>
            <div><Label htmlFor="cred">Credential / Password {s.hasCredential && <Badge variant="secondary" className="ml-2">configured</Badge>}</Label>
              <Input id="cred" type="password" autoComplete="off" placeholder={s.hasCredential ? '•••••• (unchanged)' : ''} value={credential} onChange={(e) => setCredential(e.target.value)} /></div>
            <div><Label htmlFor="su">Server URL (optional)</Label><Input id="su" value={s.serverUrl || ''} onChange={(e) => set('serverUrl', e.target.value)} placeholder="my.geotab.com" /></div>
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save</Button>
            <Button variant="outline" onClick={test} disabled={testing}>{testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlugZap className="w-4 h-4 mr-2" />}Test Connection</Button>
            <Button variant="outline" onClick={sync} disabled={syncing}>{syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Sync Now</Button>
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
          <div className="text-muted-foreground">Last successful sync: {s.lastSuccessAt ? formatDate(s.lastSuccessAt) : '—'}</div>
          <div className="text-muted-foreground">Last failed sync: {s.lastFailureAt ? formatDate(s.lastFailureAt) : '—'}</div>
          {s.lastSyncError && <div className="text-destructive">{s.lastSyncError}</div>}
        </CardContent>
      </Card>
    </div>
  );
}
