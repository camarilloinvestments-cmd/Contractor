'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Globe, ShieldCheck, ShieldAlert, CheckCircle2, XCircle, RefreshCw,
  Plus, Trash2, Search, Lock, Server, Info,
} from 'lucide-react';
import { toast } from 'sonner';

type Domain = {
  id: string;
  hostname: string;
  displayName: string | null;
  isPrimary: boolean;
  status: string;
  dnsStatus: string;
  resolvedIpv4: string | null;
  resolvedIpv6: string | null;
  expectedIpv4: string | null;
  expectedIpv6: string | null;
  httpReachable: boolean | null;
  httpsReachable: boolean | null;
  sslEnabled: boolean;
  sslStatus: string;
  certificateIssuer: string | null;
  certificateSerial: string | null;
  certificateNotBefore: string | null;
  certificateNotAfter: string | null;
  lastVerifiedAt: string | null;
  issuanceRequestedAt: string | null;
  lastIssuedAt: string | null;
  lastRenewedAt: string | null;
  lastError: string | null;
};

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-green-500/15 text-green-600 dark:text-green-400',
  READY: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  ISSUING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  RENEWAL_DUE: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  RENEWING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  PENDING: 'bg-muted text-muted-foreground',
  VERIFYING: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  DNS_ERROR: 'bg-red-500/15 text-red-600 dark:text-red-400',
  PORT_ERROR: 'bg-red-500/15 text-red-600 dark:text-red-400',
  CERT_ERROR: 'bg-red-500/15 text-red-600 dark:text-red-400',
  DISABLED: 'bg-muted text-muted-foreground',
};

function StatusBadge({ status }: { status: string }) {
  return <Badge className={STATUS_TONE[status] || 'bg-muted text-muted-foreground'} variant="secondary">{status.replace(/_/g, ' ')}</Badge>;
}

function fmt(d: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleString(); } catch { return '—'; }
}

export function DomainSslTab() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [publicIp, setPublicIp] = useState<{ ipv4: string | null; ipv6: string | null; source: string } | null>(null);
  const [canonical, setCanonical] = useState<{ configured?: string | null; active?: string | null; pendingRestart?: boolean; message?: string } | null>(null);

  // Add-domain form
  const [hostname, setHostname] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [adding, setAdding] = useState(false);

  const [diag, setDiag] = useState<any | null>(null);
  const [diagId, setDiagId] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await fetch('/api/system/domains');
      if (!r.ok) throw new Error();
      const d = await r.json();
      setDomains(d.domains || []);
    } catch { toast.error('Failed to load domains'); }
    finally { setLoading(false); }
  };

  const loadPublicIp = async () => {
    try {
      const r = await fetch('/api/system/domains/public-ip');
      if (r.ok) { const d = await r.json(); setPublicIp(d.publicIp); }
    } catch { /* non-fatal */ }
  };

  const loadCanonical = async () => {
    try {
      const r = await fetch('/api/system/domains/canonical-url');
      if (r.ok) { const d = await r.json(); setCanonical(d); }
    } catch { /* non-fatal */ }
  };

  useEffect(() => { load(); loadPublicIp(); loadCanonical(); }, []);

  const add = async () => {
    if (!hostname.trim()) { toast.error('Enter a domain'); return; }
    setAdding(true);
    try {
      const r = await fetch('/api/system/domains', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname, displayName: displayName || undefined, isPrimary }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not add domain');
      toast.success('Domain added');
      setHostname(''); setDisplayName(''); setIsPrimary(false);
      await load();
    } catch (e: any) { toast.error(e.message || 'Could not add domain'); }
    finally { setAdding(false); }
  };

  const act = async (id: string, path: string, method: string, okMsg: string) => {
    setBusyId(id);
    try {
      const r = await fetch(`/api/system/domains/${id}${path}`, { method });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) throw new Error(d.error || 'Operation failed');
      toast.success(okMsg);
      await load();
    } catch (e: any) { toast.error(e.message || 'Operation failed'); }
    finally { setBusyId(null); }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      const r = await fetch(`/api/system/domains/${id}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not remove');
      toast.success('Domain removed');
      await load();
    } catch (e: any) { toast.error(e.message || 'Could not remove'); }
    finally { setBusyId(null); }
  };

  const openDiag = async (id: string) => {
    setDiagId(id); setDiag(null);
    try {
      const r = await fetch(`/api/system/domains/${id}/diagnostics`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Diagnostics unavailable');
      setDiag(d);
    } catch (e: any) { toast.error(e.message || 'Diagnostics unavailable'); setDiagId(null); }
  };

  const applyCanonical = async (h: string) => {
    try {
      const r = await fetch('/api/system/domains/canonical-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', hostname: h }),
      });
      const d = await r.json();
      if (!r.ok || d.ok === false) throw new Error(d.error || d.message || 'Could not update canonical URL');
      toast.success('Canonical URL updated');
      await loadCanonical();
    } catch (e: any) { toast.error(e.message || 'Could not update canonical URL'); }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground p-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading domains…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Appliance public IP */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server className="w-5 h-5" /> This Server’s Public Address</CardTitle>
          <CardDescription>Point your domain’s DNS A record at this address, then verify below.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="outline" className="font-mono">IPv4: {publicIp?.ipv4 || 'not detected'}</Badge>
            {publicIp?.ipv6 ? <Badge variant="outline" className="font-mono">IPv6: {publicIp.ipv6}</Badge> : null}
            <Badge variant="secondary">source: {publicIp?.source || 'none'}</Badge>
            <Button size="sm" variant="ghost" onClick={loadPublicIp}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Re-detect</Button>
          </div>
          <p className="text-xs text-muted-foreground flex items-start gap-1"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> If this server is behind NAT, set the APPLIANCE_PUBLIC_IPV4 override so verification uses the correct external address.</p>
        </CardContent>
      </Card>

      {/* Add domain */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5" /> Add a Domain</CardTitle>
          <CardDescription>Enter the domain you want this application served on. SSL is issued automatically once it verifies.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hostname">Domain</Label>
              <Input id="hostname" placeholder="app.example.com" value={hostname} onChange={(e) => setHostname(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Display Name (optional)</Label>
              <Input id="displayName" placeholder="Production" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="primary" checked={isPrimary} onCheckedChange={setIsPrimary} />
            <Label htmlFor="primary">Set as primary domain</Label>
          </div>
          <Button onClick={add} disabled={adding}>
            {adding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />} Add Domain
          </Button>
        </CardContent>
      </Card>

      {/* Domain list */}
      {domains.length === 0 ? (
        <Alert><Globe className="w-4 h-4" /><AlertTitle>No domains yet</AlertTitle><AlertDescription>Add a domain above to get started.</AlertDescription></Alert>
      ) : domains.map((d) => (
        <Card key={d.id}>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 font-mono text-base">
                  <Globe className="w-4 h-4" /> {d.hostname}
                  {d.isPrimary ? <Badge variant="default">Primary</Badge> : null}
                </CardTitle>
                <CardDescription>{d.displayName || 'Custom domain'}</CardDescription>
              </div>
              <StatusBadge status={d.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* SSL status card (§15) */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              <Row label="DNS" value={d.dnsStatus} good={d.dnsStatus === 'OK'} bad={['MISMATCH', 'NXDOMAIN', 'ERROR'].includes(d.dnsStatus)} />
              <Row label="Public IP Match" value={d.dnsStatus === 'OK' ? 'Matches this server' : (d.resolvedIpv4 || 'unknown')} good={d.dnsStatus === 'OK'} />
              <Row label="HTTP (80)" value={d.httpReachable == null ? 'not checked' : d.httpReachable ? 'reachable' : 'unreachable'} good={!!d.httpReachable} bad={d.httpReachable === false} />
              <Row label="HTTPS (443)" value={d.httpsReachable == null ? 'not checked' : d.httpsReachable ? 'reachable' : 'unreachable'} good={!!d.httpsReachable} />
              <Row label="Certificate" value={d.sslStatus} good={d.sslStatus === 'ACTIVE'} bad={['EXPIRED', 'ERROR'].includes(d.sslStatus)} />
              <Row label="Issuer" value={d.certificateIssuer || '—'} />
              <Row label="Issuance Requested" value={fmt(d.issuanceRequestedAt)} />
              <Row label="Issued" value={fmt(d.lastIssuedAt)} good={!!d.lastIssuedAt} />
              <Row label="Last Renewed" value={fmt(d.lastRenewedAt)} />
              <Row label="Expires" value={fmt(d.certificateNotAfter)} />
              <Row label="Auto Renewal" value={d.sslEnabled ? 'Managed automatically' : 'off'} good={d.sslEnabled} />
              <Row label="Last Check" value={fmt(d.lastVerifiedAt)} />
            </div>

            {d.lastError ? (
              <Alert variant="destructive"><ShieldAlert className="w-4 h-4" /><AlertTitle>Attention</AlertTitle><AlertDescription>{d.lastError}</AlertDescription></Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busyId === d.id} onClick={() => act(d.id, '/verify', 'POST', 'Verification complete')}>
                {busyId === d.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Search className="w-3.5 h-3.5 mr-1" />} Verify {d.lastVerifiedAt ? 'Again' : 'Domain'}
              </Button>
              {!d.sslEnabled ? (
                <Button size="sm" disabled={busyId === d.id} onClick={() => act(d.id, '/ssl', 'POST', 'SSL enabled — certificate issuing')}>
                  <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Enable SSL
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" disabled={busyId === d.id} onClick={() => act(d.id, '/reissue', 'POST', 'Certificate issuance retry requested')}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry Certificate Issuance
                  </Button>
                  <Button size="sm" variant="outline" disabled={busyId === d.id} onClick={() => act(d.id, '/ssl', 'DELETE', 'SSL disabled')}>
                    <ShieldAlert className="w-3.5 h-3.5 mr-1" /> Disable SSL
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => openDiag(d.id)}>
                <Info className="w-3.5 h-3.5 mr-1" /> View Diagnostics
              </Button>
              {d.status === 'ACTIVE' ? (
                <Button size="sm" variant="ghost" onClick={() => applyCanonical(d.hostname)}>
                  <Lock className="w-3.5 h-3.5 mr-1" /> Make Canonical URL
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" className="text-red-600" disabled={busyId === d.id} onClick={() => remove(d.id)}>
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
              </Button>
            </div>

            {diagId === d.id && diag ? (
              <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                <div className="text-xs font-semibold flex items-center gap-1"><Server className="w-3.5 h-3.5" /> Generated Proxy Config (read-only)</div>
                <pre className="text-xs overflow-x-auto whitespace-pre-wrap font-mono">{diag.proxy?.configPreview}</pre>
                <div className="text-xs text-muted-foreground">Certificate probe: {diag.certificate?.probe} · serial {diag.certificate?.serial || '—'}</div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}

      {/* Canonical URL status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Lock className="w-5 h-5" /> Canonical Application URL</CardTitle>
          <CardDescription>The address used for authentication and links. Only an ACTIVE domain can become canonical; changes are backed up and can be rolled back.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <Row label="Configured (persisted)" value={canonical?.configured || '(unset)'} good={!!canonical?.configured} />
            <Row label="Active (serving now)" value={canonical?.active || '(unset)'} good={!!canonical?.active && canonical?.active === canonical?.configured} />
          </div>
          {canonical?.pendingRestart ? (
            <Alert><Info className="w-4 h-4" /><AlertTitle>Restart required</AlertTitle><AlertDescription>A new canonical URL has been staged but is not active yet. Restart the app to activate it (the change is backed up and can be rolled back).</AlertDescription></Alert>
          ) : null}
          {canonical?.message ? (
            <pre className="text-xs font-mono bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{canonical.message}</pre>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 font-medium text-right">
        {good ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : bad ? <XCircle className="w-3.5 h-3.5 text-red-600" /> : null}
        {value}
      </span>
    </div>
  );
}
