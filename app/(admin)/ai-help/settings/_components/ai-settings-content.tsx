'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Save, PlugZap, ShieldAlert, ShieldCheck, Bot, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { SecretCredentialField, EMPTY_SECRET, type SecretCredentialValue } from '@/components/secret-credential-field';

type Settings = {
  enabled: boolean;
  hasApiKey: boolean;
  apiBase: string | null;
  normalModel: string;
  fallbackModel: string;
  schemaVersion: string;
  lastSuccessAt: string | null;
  lastModelUsed: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

export function AiSettingsContent() {
  const [s, setS] = useState<Settings>({
    enabled: false, hasApiKey: false, apiBase: 'https://api.openai.com/v1',
    normalModel: 'gpt-4o-mini', fallbackModel: 'gpt-4o', schemaVersion: '1',
    lastSuccessAt: null, lastModelUsed: null, lastError: null, lastErrorAt: null,
  });
  const [cred, setCred] = useState<SecretCredentialValue>(EMPTY_SECRET);
  const [credKey, setCredKey] = useState(0);
  const [encAvailable, setEncAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = () =>
    fetch('/api/settings/ai-intake')
      .then((r) => r.json())
      .then((d) => {
        setEncAvailable(!!d.encryptionAvailable);
        if (d.settings) setS((p) => ({ ...p, ...d.settings }));
      })
      .catch(() => toast.error('Failed to load AI settings'))
      .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const set = (k: keyof Settings, v: any) => setS((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/ai-intake', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: s.enabled,
          apiKey: cred,
          normalModel: s.normalModel,
          fallbackModel: s.fallbackModel,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Save failed');
      setS((p) => ({ ...p, ...d.settings }));
      setCred(EMPTY_SECRET);
      setCredKey((k) => k + 1);
      toast.success('AI settings saved');
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/settings/ai-intake/test', { method: 'POST' });
      const d = await res.json();
      if (d.ok) toast.success('Connection successful');
      else toast.error(d.error || 'Connection failed');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><Bot className="h-5 w-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-display font-bold">AI Settings</h1>
          <p className="text-sm text-muted-foreground">OpenAI connection for Work Intake analysis. The key is encrypted and never returned to the browser.</p>
        </div>
      </div>

      {!encAvailable && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Encryption unavailable</AlertTitle>
          <AlertDescription>The server encryption key is not configured, so the API key cannot be stored securely. Set it before enabling AI intake.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>OpenAI Connection</CardTitle>
          <CardDescription>Analysis runs only when enabled and a key is configured. Analysis is always operator-triggered.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label className="text-base">Enable AI Work Intake</Label>
              <p className="text-sm text-muted-foreground">Turn on to allow operators to run AI analysis on imported work requests.</p>
            </div>
            <Switch checked={s.enabled} onCheckedChange={(v) => set('enabled', v)} />
          </div>

          <div key={credKey}>
            <SecretCredentialField
              label="OpenAI API Key"
              configured={s.hasApiKey}
              value={cred}
              onChange={setCred}
              placeholder="sk-…"
            />
          </div>

          <div className="grid gap-2">
            <Label>API Endpoint</Label>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="font-mono">https://api.openai.com/v1</span>
              <Badge variant="secondary" className="ml-auto">Pinned</Badge>
            </div>
            <p className="text-xs text-muted-foreground">The API endpoint is fixed to the official OpenAI API and cannot be changed. Your API key is only ever sent to this endpoint.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Normal Model</Label>
              <Input value={s.normalModel} onChange={(e) => set('normalModel', e.target.value)} placeholder="gpt-4o-mini" />
            </div>
            <div className="grid gap-2">
              <Label>Fallback Model</Label>
              <Input value={s.fallbackModel} onChange={(e) => set('fallbackModel', e.target.value)} placeholder="gpt-4o" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />} Save
            </Button>
            <Button variant="outline" onClick={test} disabled={testing || !s.hasApiKey}>
              {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlugZap className="h-4 w-4 mr-2" />} Test Connection
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            {s.hasApiKey ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 text-amber-600" />}
            <span>{s.hasApiKey ? 'API key configured' : 'No API key configured'}</span>
          </div>
          {s.lastSuccessAt && (
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Last success: {new Date(s.lastSuccessAt).toLocaleString()} ({s.lastModelUsed})
            </div>
          )}
          {s.lastError && (
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="h-4 w-4" /> Last error{s.lastErrorAt ? ` (${new Date(s.lastErrorAt).toLocaleString()})` : ''}: {s.lastError}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
