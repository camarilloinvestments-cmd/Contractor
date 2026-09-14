'use client';
import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Loader2, Save, RefreshCw, DownloadCloud, PackageCheck, Undo2, FileText, Upload, RotateCcw,
  ShieldAlert, ShieldCheck, CheckCircle2, XCircle, Wrench, GitBranch, Server,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils/format';

function bytes(n?: number | null) {
  if (!n || n <= 0) return '\u2014';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function resultBadge(result: string) {
  const map: Record<string, string> = {
    SUCCESS: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    FAILED: 'bg-red-100 text-red-800 border-red-200',
    IN_PROGRESS: 'bg-amber-100 text-amber-800 border-amber-200',
    ROLLED_BACK: 'bg-slate-100 text-slate-800 border-slate-200',
    PENDING: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return <Badge variant="outline" className={map[result] || ''}>{result}</Badge>;
}

export function UpdatesClient() {
  const [s, setS] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [encAvailable, setEncAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // form-only fields
  const [githubToken, setGithubToken] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const manifestRef = useRef<HTMLInputElement>(null);

  const load = () => fetch('/api/system/updates')
    .then((r) => r.json())
    .then((d) => {
      setEncAvailable(!!d.encryptionAvailable);
      if (d.settings) setS(d.settings);
      if (Array.isArray(d.history)) setHistory(d.history);
    })
    .catch(() => toast.error('Failed to load update center'))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const set = (k: string, v: any) => setS((p: any) => ({ ...p, [k]: v }));

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/system/updates/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          releaseChannel: s.releaseChannel,
          githubOwner: s.githubOwner,
          githubRepo: s.githubRepo,
          autoCheck: s.autoCheck,
          requireSignature: s.requireSignature,
          publicKeyPem: s.publicKeyPem ?? '',
          githubToken: githubToken || undefined,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Save failed'); }
      setGithubToken('');
      await load();
      toast.success('Update settings saved');
    } catch (e: any) { toast.error(e.message || 'Save failed'); } finally { setSaving(false); }
  };

  const testConn = async () => {
    setBusy('test');
    try {
      const res = await fetch('/api/system/updates/settings/test', { method: 'POST' });
      const d = await res.json();
      if (d.ok) toast.success(d.message || 'Connected'); else toast.error(d.message || 'Connection failed');
    } catch { toast.error('Test failed'); } finally { setBusy(null); }
  };

  const action = async (key: string, url: string, okMsg: string) => {
    setBusy(key);
    try {
      const res = await fetch(url, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Request failed');
      toast.success(d.note || okMsg);
      await load();
    } catch (e: any) { toast.error(e.message || 'Request failed'); } finally { setBusy(null); }
  };

  const uploadPackage = async () => {
    const pkg = fileRef.current?.files?.[0];
    const man = manifestRef.current?.files?.[0];
    if (!pkg || !man) { toast.error('Select both the package (.tar.gz) and manifest.json'); return; }
    setBusy('upload');
    try {
      const fd = new FormData();
      fd.append('package', pkg);
      fd.append('manifest', man);
      const res = await fetch('/api/system/updates/upload', { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Upload failed');
      toast.success(`Uploaded & verified ${d.manifest?.filename ?? 'package'}`);
      if (fileRef.current) fileRef.current.value = '';
      if (manifestRef.current) manifestRef.current.value = '';
      await load();
    } catch (e: any) { toast.error(e.message || 'Upload failed'); } finally { setBusy(null); }
  };

  const toggleMaintenance = async (enabled: boolean) => {
    setBusy('maint');
    try {
      const res = await fetch('/api/system/updates/maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      if (d.settings) setS(d.settings);
      toast.success(enabled ? 'Maintenance mode enabled' : 'Maintenance mode disabled');
    } catch (e: any) { toast.error(e.message || 'Failed'); } finally { setBusy(null); }
  };

  if (loading || !s) return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const updateAvailable = !!s.latestVersion && s.latestVersion !== s.currentVersion;
  const hasFailed = history.some((h) => h.result === 'FAILED');

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><DownloadCloud className="w-5 h-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">System Update Center</h1>
          <p className="text-sm text-muted-foreground">Check, verify, and install signed release packages from GitHub. No unverified package is ever installed.</p>
        </div>
      </div>

      {s.maintenanceMode && (
        <Alert className="border-amber-300 bg-amber-50"><Wrench className="w-4 h-4 text-amber-700" />
          <AlertTitle className="text-amber-800">Maintenance mode is ON</AlertTitle>
          <AlertDescription className="text-amber-700 flex items-center justify-between gap-4">
            <span>The application is flagged for maintenance during an update.</span>
            <Button size="sm" variant="outline" disabled={busy === 'maint'} onClick={() => toggleMaintenance(false)}>Disable</Button>
          </AlertDescription>
        </Alert>
      )}

      {!encAvailable && (
        <Alert variant="destructive"><ShieldAlert className="w-4 h-4" /><AlertTitle>Encryption key missing</AlertTitle>
          <AlertDescription>APP_ENCRYPTION_KEY is not configured. A GitHub token for the private repository cannot be stored until it is set.</AlertDescription></Alert>
      )}

      {/* Version status */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Server className="w-4 h-4" /> Version Status</CardTitle>
          <CardDescription>Current and latest release information.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Current Version"><span className="font-mono">{s.currentVersion}</span></Field>
            <Field label="Latest Version">
              <span className="font-mono">{s.latestVersion ?? '\u2014'}</span>{' '}
              {updateAvailable && <Badge className="ml-1 bg-primary text-primary-foreground">Update available</Badge>}
              {!updateAvailable && s.latestVersion && <Badge variant="outline" className="ml-1">Up to date</Badge>}
            </Field>
            <Field label="Release Date">{s.latestReleaseAt ? formatDate(s.latestReleaseAt) : '\u2014'}</Field>
            <Field label="Release Channel"><Badge variant="outline">{s.releaseChannel}</Badge></Field>
            <Field label="Git Commit"><span className="font-mono text-xs">{s.latestCommit ? String(s.latestCommit).slice(0, 12) : '\u2014'}</span></Field>
            <Field label="Package Size">{bytes(s.latestPackageBytes)}</Field>
            <Field label="Last Update Check">{s.lastCheckAt ? formatDate(s.lastCheckAt) : 'Never'} {s.lastCheckStatus && <Badge variant="outline" className="ml-1">{s.lastCheckStatus}</Badge>}</Field>
            <Field label="Last Successful Update">{s.lastSuccessfulUpdateAt ? formatDate(s.lastSuccessfulUpdateAt) : '\u2014'}</Field>
            <Field label="Last Failed Update">{s.lastFailedUpdateAt ? formatDate(s.lastFailedUpdateAt) : '\u2014'}</Field>
          </div>
          {s.lastCheckError && <Alert variant="destructive"><XCircle className="w-4 h-4" /><AlertDescription>{s.lastCheckError}</AlertDescription></Alert>}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button disabled={busy === 'check'} onClick={() => action('check', '/api/system/updates/check', 'Checked for updates')}>
              {busy === 'check' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Check for Updates</Button>
            <Button variant="outline" disabled={busy === 'download' || !updateAvailable} onClick={() => action('download', '/api/system/updates/download', 'Downloaded & verified')}>
              {busy === 'download' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <DownloadCloud className="w-4 h-4 mr-2" />}Download Update</Button>
            <Button variant="outline" disabled={busy === 'install'} onClick={() => action('install', '/api/system/updates/install', 'Install prepared')}>
              {busy === 'install' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PackageCheck className="w-4 h-4 mr-2" />}Install Update</Button>
            <Button variant="outline" disabled={busy === 'rollback'} onClick={() => action('rollback', '/api/system/updates/rollback', 'Rollback prepared')}>
              {busy === 'rollback' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Undo2 className="w-4 h-4 mr-2" />}Rollback</Button>
            <Button variant="outline" disabled={!s.latestReleaseNotes} onClick={() => setNotesOpen(true)}>
              <FileText className="w-4 h-4 mr-2" />View Release Notes</Button>
            {hasFailed && (
              <Button variant="outline" disabled={busy === 'retry'} onClick={() => action('retry', '/api/system/updates/retry', 'Retried failed update')}>
                {busy === 'retry' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}Retry Failed Update</Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Install and rollback prepare and verify the package, enable maintenance mode, and write an install plan. The host installer script (<span className="font-mono">scripts/install-update.sh</span>) then applies migrations, swaps the release, restarts, runs health checks, and auto-rolls back on failure.</p>
        </CardContent>
      </Card>

      {/* Settings */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><GitBranch className="w-4 h-4" /> GitHub Release Source</CardTitle>
          <CardDescription>GitHub is the source of truth. Private repositories are supported — the token is encrypted at rest and never returned to the browser.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Release Channel</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={s.releaseChannel} onChange={(e) => set('releaseChannel', e.target.value)}>
                <option value="STABLE">Stable</option>
                <option value="RC">Release Candidate</option>
                <option value="BETA">Beta</option>
              </select>
            </div>
            <div className="space-y-1.5"><Label>GitHub Owner</Label><Input value={s.githubOwner ?? ''} onChange={(e) => set('githubOwner', e.target.value)} placeholder="camarilloinvestments-cmd" /></div>
            <div className="space-y-1.5"><Label>GitHub Repository</Label><Input value={s.githubRepo ?? ''} onChange={(e) => set('githubRepo', e.target.value)} placeholder="Contractor" /></div>
          </div>
          <div className="space-y-1.5">
            <Label>GitHub Access Token {s.hasToken && <Badge variant="outline" className="ml-1">stored</Badge>}</Label>
            <Input type="password" value={githubToken} onChange={(e) => setGithubToken(e.target.value)} placeholder={s.hasToken ? 'Leave blank to keep current token' : 'ghp_… (needs read access to the private repo)'} autoComplete="off" />
            <p className="text-xs text-muted-foreground">Write-only. Encrypted on save and never sent back to the browser.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Signature Public Key (PEM) {s.hasPublicKey && <Badge variant="outline" className="ml-1">configured</Badge>}</Label>
            <textarea className="w-full min-h-24 rounded-md border border-input bg-background p-3 text-sm font-mono" value={s.publicKeyPem ?? ''} onChange={(e) => set('publicKeyPem', e.target.value)} placeholder="-----BEGIN PUBLIC KEY-----" />
            <p className="text-xs text-muted-foreground">When set, the manifest signature is verified in addition to the SHA-256 checksum.</p>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div><p className="text-sm font-medium flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Require signature</p><p className="text-xs text-muted-foreground">Refuse any package whose signature is missing or invalid.</p></div>
            <Switch checked={!!s.requireSignature} onCheckedChange={(v) => set('requireSignature', v)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div><p className="text-sm font-medium">Automatic update checks</p><p className="text-xs text-muted-foreground">Periodically check GitHub for new releases on the selected channel.</p></div>
            <Switch checked={!!s.autoCheck} onCheckedChange={(v) => set('autoCheck', v)} />
          </div>
          <div className="flex gap-2">
            <Button disabled={saving} onClick={saveSettings}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save Settings</Button>
            <Button variant="outline" disabled={busy === 'test'} onClick={testConn}>{busy === 'test' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}Test Connection</Button>
          </div>
        </CardContent>
      </Card>

      {/* Manual upload */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="w-4 h-4" /> Upload Package</CardTitle>
          <CardDescription>Manually stage a release package. It goes through the exact same verification path (checksum, and signature when configured) before it can be installed.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Package (.tar.gz)</Label><Input ref={fileRef} type="file" accept=".gz,.tgz,application/gzip" /></div>
            <div className="space-y-1.5"><Label>manifest.json</Label><Input ref={manifestRef} type="file" accept=".json,application/json" /></div>
          </div>
          <Button variant="outline" disabled={busy === 'upload'} onClick={uploadPackage}>{busy === 'upload' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}Upload & Verify</Button>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader><CardTitle>Update History</CardTitle><CardDescription>Every check, download, install, rollback, and upload is recorded.</CardDescription></CardHeader>
        <CardContent>
          {history.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">No update activity yet.</p> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>Source</TableHead>
                  <TableHead>From → To</TableHead><TableHead>Result</TableHead><TableHead>By</TableHead><TableHead>Message</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDate(h.createdAt)}</TableCell>
                      <TableCell><Badge variant="outline">{h.action}</Badge></TableCell>
                      <TableCell className="text-xs">{h.source}</TableCell>
                      <TableCell className="font-mono text-xs">{h.fromVersion ?? '\u2014'}{' \u2192 '}{h.toVersion ?? '\u2014'}</TableCell>
                      <TableCell>{resultBadge(h.result)}{h.rollbackResult && <div className="text-[10px] text-muted-foreground mt-1">rollback: {h.rollbackResult}</div>}</TableCell>
                      <TableCell className="text-xs">{h.installedBy ?? '\u2014'}</TableCell>
                      <TableCell className="text-xs max-w-xs truncate" title={h.message ?? ''}>{h.message ?? '\u2014'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Release Notes — {s.latestVersion}</DialogTitle><DialogDescription>{s.latestReleaseAt ? formatDate(s.latestReleaseAt) : ''}</DialogDescription></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm">{s.latestReleaseNotes || 'No release notes available.'}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}
