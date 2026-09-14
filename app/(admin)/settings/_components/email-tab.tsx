'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, Send, ShieldAlert, ShieldCheck, PlugZap, Info } from 'lucide-react';
import { toast } from 'sonner';
import { SecretCredentialField, EMPTY_SECRET, type SecretCredentialValue } from '@/components/secret-credential-field';

type ProviderPreset = {
  key: string;
  label: string;
  host: string | null;
  port: number | null;
  transportMode: string | null;
  authMethods: string[];
  fixedUsername: string | null;
  hostEditable: boolean;
  notes: string | null;
};

const TRANSPORT_LABELS: Record<string, string> = {
  STARTTLS: 'STARTTLS (upgrade on 587)',
  IMPLICIT_TLS: 'Implicit TLS / SSL (465)',
  NONE: 'None (no encryption \u2014 discouraged)',
};
const AUTH_LABELS: Record<string, string> = {
  PASSWORD: 'Password / App Password',
  OAUTH2: 'OAuth2',
};

export function EmailTab() {
  const [s, setS] = useState<any>({
    enabled: false, host: '', port: 587, secure: false, username: '', fromName: '', fromEmail: '', replyTo: '',
    hasPassword: false, provider: 'custom', transportMode: 'STARTTLS', authMethod: 'PASSWORD',
    oauthClientId: '', oauthTenantId: '', hasOauthClientSecret: false, hasOauthRefreshToken: false,
  });
  const [providers, setProviders] = useState<ProviderPreset[]>([]);
  const [transportModes, setTransportModes] = useState<string[]>(['STARTTLS', 'IMPLICIT_TLS', 'NONE']);
  const [cred, setCred] = useState<SecretCredentialValue>(EMPTY_SECRET);
  const [clientSecret, setClientSecret] = useState<SecretCredentialValue>(EMPTY_SECRET);
  const [refreshToken, setRefreshToken] = useState<SecretCredentialValue>(EMPTY_SECRET);
  const [credKey, setCredKey] = useState(0); // bump to remount secret fields into masked view after a save
  const [encAvailable, setEncAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [testTo, setTestTo] = useState('');

  const load = () => {
    return fetch('/api/settings/email')
      .then((r) => r.json())
      .then((d) => {
        setEncAvailable(!!d.encryptionAvailable);
        if (Array.isArray(d.providers)) setProviders(d.providers);
        if (Array.isArray(d.transportModes)) setTransportModes(d.transportModes);
        if (d.settings) setS((p: any) => ({ ...p, ...d.settings }));
      })
      .catch(() => toast.error('Failed to load email settings'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const set = (k: string, v: any) => setS((p: any) => ({ ...p, [k]: v }));

  const currentPreset = providers.find((p) => p.key === s.provider);
  const allowedAuthMethods = currentPreset?.authMethods?.length ? currentPreset.authMethods : ['PASSWORD', 'OAUTH2'];
  const hostEditable = !currentPreset || currentPreset.hostEditable || currentPreset.key === 'custom';

  // Apply a provider preset: fill host/port/transport/username defaults and
  // constrain the auth method to one the provider supports.
  const applyProvider = (key: string) => {
    const preset = providers.find((p) => p.key === key);
    setS((p: any) => {
      const next: any = { ...p, provider: key };
      if (preset) {
        if (preset.host != null) next.host = preset.host;
        if (preset.port != null) next.port = preset.port;
        if (preset.transportMode) next.transportMode = preset.transportMode;
        if (preset.fixedUsername) next.username = preset.fixedUsername;
        const methods = preset.authMethods?.length ? preset.authMethods : ['PASSWORD', 'OAUTH2'];
        if (!methods.includes(next.authMethod)) next.authMethod = methods[0];
      }
      return next;
    });
  };

  const buildBody = () => ({
    ...s,
    password: cred.password || undefined,
    clearPassword: cred.clear || undefined,
    oauthClientSecret: clientSecret.password || undefined,
    clearOauthClientSecret: clientSecret.clear || undefined,
    oauthRefreshToken: refreshToken.password || undefined,
    clearOauthRefreshToken: refreshToken.clear || undefined,
  });

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'save failed');
      }
      setCred(EMPTY_SECRET);
      setClientSecret(EMPTY_SECRET);
      setRefreshToken(EMPTY_SECRET);
      toast.success('Email settings saved');
      await load();
      setCredKey((k) => k + 1);
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const verifyConnection = async () => {
    setVerifying(true);
    try {
      const res = await fetch('/api/settings/email/verify', { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || 'connection failed');
      toast.success('Connection successful');
    } catch (e: any) {
      toast.error(e.message || 'Connection failed');
    } finally {
      setVerifying(false);
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

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground p-6"><Loader2 className="w-4 h-4 animate-spin" />Loading...</div>;

  const isOauth = s.authMethod === 'OAUTH2';
  const isM365 = s.provider === 'm365';

  return (
    <div className="space-y-6">
      {encAvailable ? (
        <Alert>
          <ShieldCheck className="w-4 h-4" />
          <AlertTitle>Encryption available</AlertTitle>
          <AlertDescription>Email credentials (password, OAuth2 client secret and refresh token) are encrypted at rest with AES-256-GCM using the server encryption key.</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <ShieldAlert className="w-4 h-4" />
          <AlertTitle>Encryption key missing</AlertTitle>
          <AlertDescription>APP_ENCRYPTION_KEY is not configured. Saving email credentials is disabled until the key is set on the server (fail-closed). Contact your administrator.</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>SMTP / Email Delivery</CardTitle>
          <CardDescription>Choose your email provider and configure the outbound mail server used to send invoices, quotes, estimates and notifications.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={!!s.enabled} onCheckedChange={(v: boolean) => set('enabled', v)} />
            <Label>Email sending enabled</Label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Email Provider</Label>
              <Select value={s.provider ?? 'custom'} onValueChange={applyProvider}>
                <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                <SelectContent>
                  {providers.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Authentication Method</Label>
              <Select value={s.authMethod ?? 'PASSWORD'} onValueChange={(v: string) => set('authMethod', v)}>
                <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                <SelectContent>
                  {allowedAuthMethods.map((m) => <SelectItem key={m} value={m}>{AUTH_LABELS[m] ?? m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {currentPreset?.notes ? (
            <Alert>
              <Info className="w-4 h-4" />
              <AlertDescription>{currentPreset.notes}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>SMTP Host</Label>
              <Input value={s.host ?? ''} placeholder="smtp.example.com" disabled={!hostEditable} onChange={(e: any) => set('host', e.target.value)} />
            </div>
            <div className="space-y-1"><Label>Port</Label><Input type="number" value={s.port ?? ''} placeholder="587" onChange={(e: any) => set('port', e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Transport Encryption</Label>
              <Select value={s.transportMode ?? 'STARTTLS'} onValueChange={(v: string) => set('transportMode', v)}>
                <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
                <SelectContent>
                  {transportModes.map((m) => <SelectItem key={m} value={m}>{TRANSPORT_LABELS[m] ?? m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Username{currentPreset?.fixedUsername ? ' (fixed by provider)' : ''}</Label>
              <Input value={s.username ?? ''} disabled={!!currentPreset?.fixedUsername} onChange={(e: any) => set('username', e.target.value)} />
            </div>
          </div>

          {isOauth ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border p-4 bg-muted/30">
              <div className="space-y-1">
                <Label>OAuth2 Client ID</Label>
                <Input value={s.oauthClientId ?? ''} onChange={(e: any) => set('oauthClientId', e.target.value)} />
              </div>
              {isM365 ? (
                <div className="space-y-1">
                  <Label>Azure AD Tenant ID</Label>
                  <Input value={s.oauthTenantId ?? ''} placeholder="contoso.onmicrosoft.com or GUID" onChange={(e: any) => set('oauthTenantId', e.target.value)} />
                </div>
              ) : null}
              <div className="space-y-1">
                <SecretCredentialField
                  key={`cs-${credKey}`}
                  label="OAuth2 Client Secret"
                  configured={!!s.hasOauthClientSecret}
                  disabled={!encAvailable}
                  disabledReason="APP_ENCRYPTION_KEY is not configured on the server"
                  value={clientSecret}
                  onChange={setClientSecret}
                  placeholder="Enter client secret"
                />
              </div>
              <div className="space-y-1">
                <SecretCredentialField
                  key={`rt-${credKey}`}
                  label="OAuth2 Refresh Token"
                  configured={!!s.hasOauthRefreshToken}
                  disabled={!encAvailable}
                  disabledReason="APP_ENCRYPTION_KEY is not configured on the server"
                  value={refreshToken}
                  onChange={setRefreshToken}
                  placeholder="Enter refresh token"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <SecretCredentialField
                  key={`pw-${credKey}`}
                  label="Password / App Password"
                  configured={!!s.hasPassword}
                  disabled={!encAvailable}
                  disabledReason="APP_ENCRYPTION_KEY is not configured on the server"
                  value={cred}
                  onChange={setCred}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1"><Label>From Name</Label><Input value={s.fromName ?? ''} onChange={(e: any) => set('fromName', e.target.value)} /></div>
            <div className="space-y-1"><Label>From Email</Label><Input value={s.fromEmail ?? ''} placeholder="noreply@example.com" onChange={(e: any) => set('fromEmail', e.target.value)} /></div>
            <div className="space-y-1"><Label>Reply-To</Label><Input value={s.replyTo ?? ''} onChange={(e: any) => set('replyTo', e.target.value)} /></div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save Email Settings
            </Button>
            <Button onClick={verifyConnection} disabled={verifying} variant="outline">
              {verifying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlugZap className="w-4 h-4 mr-2" />}Test Connection
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Test Connection verifies the server and credentials without sending a message. Save your changes first.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Send Test Email</CardTitle>
          <CardDescription>Sends a test message using the saved settings to verify delivery end-to-end.</CardDescription>
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
