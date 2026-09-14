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
  ShieldAlert, ShieldCheck, CheckCircle2, XCircle, AlertTriangle, Wrench, GitBranch, Server,
  ChevronDown, ChevronRight, Github, PlayCircle, Circle,
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

function dash(v: any) { return v === null || v === undefined || v === '' ? '\u2014' : v; }

function duration(ms?: number | null, start?: string | null, end?: string | null) {
  let d = ms ?? null;
  if (d === null && start && end) d = new Date(end).getTime() - new Date(start).getTime();
  if (d === null || d < 0) return '\u2014';
  if (d < 1000) return `${d} ms`;
  const s = Math.round(d / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function resultBadge(result?: string) {
  const map: Record<string, string> = {
    SUCCESS: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    COMPLETE: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    OK: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    FAILED: 'bg-red-100 text-red-800 border-red-200',
    IN_PROGRESS: 'bg-amber-100 text-amber-800 border-amber-200',
    ROLLED_BACK: 'bg-slate-100 text-slate-800 border-slate-200',
    PENDING: 'bg-slate-100 text-slate-600 border-slate-200',
    SKIPPED: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  if (!result) return <span className="text-muted-foreground">{'\u2014'}</span>;
  return <Badge variant="outline" className={map[result] || ''}>{result}</Badge>;
}

const CHECK_ICON: Record<string, any> = {
  pass: <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
  warn: <AlertTriangle className="w-4 h-4 text-amber-600" />,
  fail: <XCircle className="w-4 h-4 text-red-600" />,
};

export function UpdatesClient() {
  const [s, setS] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [encAvailable, setEncAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [githubToken, setGithubToken] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<any>(null);

  // precheck + pipeline state
  const [precheck, setPrecheck] = useState<any>(null);
  const [pipeline, setPipeline] = useState<any[]>([]);
  const [dbMutatingFrom, setDbMutatingFrom] = useState<string>('migrations');

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

  const runPrecheck = async () => {
    setBusy('precheck');
    try {
      const res = await fetch('/api/system/updates/precheck', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Precheck failed');
      setPrecheck(d.report);
      setPipeline(d.pipeline || []);
      setDbMutatingFrom(d.dbMutatingFrom || 'migrations');
      if (d.report?.ok) toast.success('Prechecks passed'); else toast.error('Prechecks reported failures');
    } catch (e: any) { toast.error(e.message || 'Precheck failed'); } finally { setBusy(null); }
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

  const checkForUpdates = () => action('check', '/api/system/updates/check', 'Checked for updates');

  const installUpdate = async () => {
    // Ensure prechecks are loaded before install; open pipeline view.
    if (!precheck) { await runPrecheck(); }
    setPipelineOpen(true);
    await action('install', '/api/system/updates/install', 'Update staged for installation');
  };

  const rollback = () => action('rollback', '/api/system/updates/rollback', 'Rollback initiated');

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
  const githubConfigured = !!s.githubConfigured;
  const signatureEnforced = !!s.signatureEnforced;
  const signaturePinned = !!s.signaturePinned;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><DownloadCloud className="w-5 h-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">System Update Center</h1>
          <p className="text-sm text-muted-foreground">Review and install signed appliance releases. No unverified package is ever installed.</p>
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

      {/* ==================== SIMPLE OPERATOR CARD ==================== */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server className="w-4 h-4" /> Appliance Status</CardTitle>
          <CardDescription>Everything an operator needs to keep this appliance current.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs uppercase text-muted-foreground tracking-wide">Current Version</div>
              <div className="font-mono text-lg font-semibold">{s.currentVersion}</div>
              <div className="font-mono text-xs text-muted-foreground">{dash(s.currentShortCommit)}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground tracking-wide">Channel</div>
              <div className="text-lg font-semibold">{s.releaseChannel}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground tracking-wide">Status</div>
              {updateAvailable ? (
                <Badge className="bg-amber-100 text-amber-800 border-amber-200" variant="outline">Update Available</Badge>
              ) : (
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200" variant="outline">Up to date</Badge>
              )}
              {updateAvailable && <div className="font-mono text-xs mt-1">{'\u2192'} {s.latestVersion}</div>}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm">
                <Github className="w-3.5 h-3.5" />
                <span className={githubConfigured ? 'text-emerald-700' : 'text-muted-foreground'}>
                  GitHub Connection: {githubConfigured ? 'CONNECTED' : 'Not connected'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <ShieldCheck className={`w-3.5 h-3.5 ${signatureEnforced ? 'text-emerald-700' : 'text-amber-600'}`} />
                <span className={signatureEnforced ? 'text-emerald-700' : 'text-amber-700'}>
                  Release Signature: {signatureEnforced ? 'Verified' : 'Not enforced'}
                </span>
              </div>
            </div>
          </div>

          {updateAvailable && s.latestNotes && (
            <Alert className="border-primary/30 bg-primary/5">
              <FileText className="w-4 h-4" />
              <AlertTitle>Release {s.latestVersion} is available</AlertTitle>
              <AlertDescription className="text-sm line-clamp-2">{s.latestNotes}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={checkForUpdates} disabled={busy === 'check'}>
              {busy === 'check' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Check for Updates
            </Button>
            <Button variant="outline" onClick={() => { setReviewOpen(true); if (!precheck) runPrecheck(); }}>
              <FileText className="w-4 h-4 mr-2" /> Review Update
            </Button>
            <Button onClick={installUpdate} disabled={busy === 'install' || !updateAvailable}>
              {busy === 'install' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PackageCheck className="w-4 h-4 mr-2" />}
              Install Update
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Last checked: {s.lastCheckAt ? formatDate(s.lastCheckAt) : 'never'}
          </p>
        </CardContent>
      </Card>

      {/* ==================== UPDATE HISTORY ==================== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Update History</CardTitle>
          <CardDescription>Every check, install, and rollback. Click a row for full details.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No update activity recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>SHA</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Backup</TableHead>
                    <TableHead>Migrations</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead>Rollback</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailRow(h)}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDate(h.createdAt || h.startedAt)}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{dash(h.fromVersion)} {'\u2192'} {dash(h.toVersion)}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{dash(h.fromCommit)} {'\u2192'} {dash(h.toCommit || h.commit)}</TableCell>
                      <TableCell>{resultBadge(h.result)}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{duration(h.durationMs, h.startedAt, h.finishedAt)}</TableCell>
                      <TableCell>{resultBadge(h.backupResult)}</TableCell>
                      <TableCell>{resultBadge(h.migrationsResult)}</TableCell>
                      <TableCell>{resultBadge(h.healthResult)}</TableCell>
                      <TableCell>{resultBadge(h.rollbackResult)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ==================== ADVANCED SUBMENU (hidden by default) ==================== */}
      <Card>
        <button type="button" className="w-full flex items-center justify-between p-4 text-left" onClick={() => setAdvOpen((o) => !o)}>
          <span className="flex items-center gap-2 font-medium"><Wrench className="w-4 h-4" /> Advanced</span>
          {advOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {advOpen && (
          <CardContent className="space-y-6 border-t pt-6">
            {/* Signature policy: read-only, pinned/enforced */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="w-4 h-4 text-emerald-700" /> Release Signature Policy
              </div>
              <p className="text-sm text-muted-foreground">
                Signing key is <strong>pinned and bundled with the appliance</strong>{signaturePinned ? '' : ' (using default policy)'}. Signed releases are
                required by default and this cannot be disabled from the operator UI. Status:{' '}
                <span className="font-medium text-emerald-700">{signatureEnforced ? 'Enforced \u2014 Verified' : 'Signed-by-default'}</span>.
              </p>
            </div>

            {/* Release source */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Release Channel</Label>
                <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={s.releaseChannel}
                  onChange={(e) => set('releaseChannel', e.target.value)}>
                  <option value="STABLE">Stable</option>
                  <option value="RC">RC</option>
                  <option value="BETA">Beta</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Auto-check for updates</Label>
                <div className="flex items-center gap-2 h-9"><Switch checked={!!s.autoCheck} onCheckedChange={(v) => set('autoCheck', v)} /><span className="text-sm text-muted-foreground">{s.autoCheck ? 'Enabled' : 'Disabled'}</span></div>
              </div>
              <div className="space-y-2">
                <Label>GitHub Owner</Label>
                <Input value={s.githubOwner || ''} onChange={(e) => set('githubOwner', e.target.value)} placeholder="org-or-user" />
              </div>
              <div className="space-y-2">
                <Label>GitHub Repository</Label>
                <Input value={s.githubRepo || ''} onChange={(e) => set('githubRepo', e.target.value)} placeholder="repo-name" />
              </div>
            </div>

            {/* Private-repo token: only shown when not yet connected. Write-only. */}
            {!githubConfigured && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><Github className="w-3.5 h-3.5" /> Connect GitHub (private repository)</Label>
                {!encAvailable && (
                  <Alert variant="destructive"><ShieldAlert className="w-4 h-4" /><AlertTitle>Encryption key missing</AlertTitle>
                    <AlertDescription>APP_ENCRYPTION_KEY must be set before a token can be stored.</AlertDescription></Alert>
                )}
                <Input type="password" autoComplete="off" value={githubToken} disabled={!encAvailable}
                  onChange={(e) => setGithubToken(e.target.value)} placeholder="Personal access token (stored encrypted, never displayed)" />
                <p className="text-xs text-muted-foreground">The token is stored write-only and never returned to the browser. Public repositories do not require a token.</p>
              </div>
            )}
            {githubConfigured && (
              <p className="text-sm text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> GitHub Connection: CONNECTED (token stored, hidden)</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={saveSettings} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Save Settings</Button>
              <Button variant="outline" onClick={testConn} disabled={busy === 'test'}>{busy === 'test' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <GitBranch className="w-4 h-4 mr-2" />} Test Connection</Button>
              <Button variant="outline" onClick={runPrecheck} disabled={busy === 'precheck'}>{busy === 'precheck' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />} Run Prechecks</Button>
              <Button variant="outline" onClick={() => toggleMaintenance(!s.maintenanceMode)} disabled={busy === 'maint'}><Wrench className="w-4 h-4 mr-2" /> {s.maintenanceMode ? 'Disable' : 'Enable'} Maintenance</Button>
              <Button variant="outline" onClick={rollback} disabled={busy === 'rollback'}><Undo2 className="w-4 h-4 mr-2" /> Rollback</Button>
            </div>

            {/* Manual package upload */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="text-sm font-medium flex items-center gap-2"><Upload className="w-4 h-4" /> Manual Package Upload (air-gapped)</div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Package (.tar.gz)</Label><Input ref={fileRef} type="file" accept=".gz,.tgz,.tar.gz" /></div>
                <div className="space-y-1"><Label className="text-xs">Manifest (manifest.json)</Label><Input ref={manifestRef} type="file" accept=".json" /></div>
              </div>
              <Button variant="outline" onClick={uploadPackage} disabled={busy === 'upload'}>{busy === 'upload' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PackageCheck className="w-4 h-4 mr-2" />} Upload & Verify</Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ==================== REVIEW / PRECHECK DIALOG ==================== */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Update</DialogTitle>
            <DialogDescription>Release notes and pre-installation checks.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-1">Release {dash(s.latestVersion)} {s.latestCommit ? `(${String(s.latestCommit).slice(0, 7)})` : ''}</div>
              <pre className="text-xs whitespace-pre-wrap bg-muted/40 rounded p-3 max-h-40 overflow-y-auto">{s.latestNotes || 'No release notes available.'}</pre>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Prechecks</span>
              <Button size="sm" variant="outline" onClick={runPrecheck} disabled={busy === 'precheck'}>{busy === 'precheck' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />} Run</Button>
            </div>
            {precheck ? (
              <div className="space-y-1">
                {(precheck.items || []).map((it: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-sm border-b py-1.5">
                    {CHECK_ICON[it.status] || <Circle className="w-4 h-4" />}
                    <div className="flex-1">
                      <div className="font-medium">{it.label}{it.advanced ? <span className="ml-2 text-[10px] uppercase text-muted-foreground">advanced</span> : null}</div>
                      {it.detail && <div className="text-xs text-muted-foreground">{it.detail}</div>}
                    </div>
                  </div>
                ))}
                <div className="pt-2 text-sm font-medium">{precheck.ok ? <span className="text-emerald-700">All prechecks passed{precheck.hasWarnings ? ' (with warnings)' : ''}.</span> : <span className="text-red-700">Prechecks failed \u2014 resolve before installing.</span>}</div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Run prechecks to validate the appliance before installing.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ==================== INSTALL PIPELINE DIALOG ==================== */}
      <Dialog open={pipelineOpen} onOpenChange={setPipelineOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Installation Pipeline</DialogTitle>
            <DialogDescription>Each step runs in order. After the database migration step, a rollback requires a database restore.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            {(pipeline.length ? pipeline : []).map((step: any, i: number) => (
              <div key={step.key} className="flex items-start gap-2 text-sm border-b py-2">
                <span className="font-mono text-xs text-muted-foreground w-5">{i + 1}</span>
                <div className="flex-1">
                  <div className="font-medium">{step.label}{step.key === dbMutatingFrom ? <span className="ml-2 text-[10px] uppercase text-red-600">DB mutating from here</span> : null}</div>
                  {step.detail && <div className="text-xs text-muted-foreground">{step.detail}</div>}
                </div>
              </div>
            ))}
            {!pipeline.length && <p className="text-sm text-muted-foreground">Run prechecks to load the pipeline steps.</p>}
          </div>
          <Alert className="border-amber-300 bg-amber-50 mt-2">
            <AlertTriangle className="w-4 h-4 text-amber-700" />
            <AlertTitle className="text-amber-800">Rollback policy</AlertTitle>
            <AlertDescription className="text-amber-700 text-xs">Failures before the migration step roll back the application automatically. Failures after it stop and display "DATABASE RESTORE REQUIRED" as a controlled action.</AlertDescription>
          </Alert>
        </DialogContent>
      </Dialog>

      {/* ==================== HISTORY ROW DETAIL DIALOG ==================== */}
      <Dialog open={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Update Record</DialogTitle>
            <DialogDescription>{detailRow ? formatDate(detailRow.createdAt || detailRow.startedAt) : ''}</DialogDescription>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">Action:</span> {dash(detailRow.action)}</div>
                <div><span className="text-muted-foreground">Result:</span> {resultBadge(detailRow.result)}</div>
                <div><span className="text-muted-foreground">Version:</span> <span className="font-mono">{dash(detailRow.fromVersion)} {'\u2192'} {dash(detailRow.toVersion)}</span></div>
                <div><span className="text-muted-foreground">SHA:</span> <span className="font-mono">{dash(detailRow.fromCommit)} {'\u2192'} {dash(detailRow.toCommit || detailRow.commit)}</span></div>
                <div><span className="text-muted-foreground">Duration:</span> {duration(detailRow.durationMs, detailRow.startedAt, detailRow.finishedAt)}</div>
                <div><span className="text-muted-foreground">Backup:</span> {resultBadge(detailRow.backupResult)}</div>
                <div><span className="text-muted-foreground">Migrations:</span> {resultBadge(detailRow.migrationsResult)}</div>
                <div><span className="text-muted-foreground">Health:</span> {resultBadge(detailRow.healthResult)}</div>
                <div><span className="text-muted-foreground">Rollback:</span> {resultBadge(detailRow.rollbackResult)}</div>
                <div><span className="text-muted-foreground">By:</span> {dash(detailRow.installedBy)}</div>
              </div>
              {detailRow.message && <div><span className="text-muted-foreground">Message:</span> {detailRow.message}</div>}
              {detailRow.logs && (
                <div>
                  <div className="text-muted-foreground mb-1">Logs</div>
                  <pre className="text-xs whitespace-pre-wrap bg-muted/40 rounded p-3 max-h-64 overflow-y-auto">{detailRow.logs}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
