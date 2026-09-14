'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TabletSmartphone, MoreHorizontal, Smartphone, Tablet, Monitor, ShieldOff, Eye, RefreshCw } from 'lucide-react';
import { formatDate } from '@/lib/utils/format';
import { FadeIn } from '@/components/ui/animate';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  REVOKED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  INACTIVE: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
};

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

function platformIcon(p: string) {
  if (p === 'IOS' || p === 'ANDROID') return Smartphone;
  if (p === 'TABLET' || p === 'IPADOS') return Tablet;
  return Monitor;
}

type Device = {
  id: string;
  deviceUuid: string;
  deviceName: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  appVersion: string | null;
  platform: string;
  status: string;
  lastSeenAt: string | null;
  lastIp: string | null;
  createdAt: string;
  worker: { id: string; name: string; companyName: string | null } | null;
  user: { id: string; email: string; name: string | null } | null;
  sessions: { id: string; createdAt: string; expiresAt: string; lastUsedAt: string | null }[];
};

export function DevicesContent() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Device | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'device' | 'session' | 'user'; id: string; label: string }>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/system/devices');
      if (!res.ok) throw new Error('Failed to load devices');
      const data = await res.json();
      setDevices(data.devices || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function ownerLabel(d: Device): string {
    if (d.user) return d.user.name || d.user.email;
    if (d.worker) return d.worker.name + (d.worker.companyName ? ` (${d.worker.companyName})` : '');
    return '—';
  }

  function newestSession(d: Device) {
    return d.sessions && d.sessions.length > 0 ? d.sessions[0] : null;
  }

  async function doRevoke() {
    if (!confirm) return;
    setBusy(true);
    try {
      let url = '';
      if (confirm.kind === 'device') url = `/api/system/devices/${confirm.id}/revoke`;
      else if (confirm.kind === 'session') url = `/api/system/devices/sessions/${confirm.id}/revoke`;
      else url = `/api/system/devices/user/${confirm.id}/revoke`;
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Revoke failed');
      }
      const j = await res.json().catch(() => ({}));
      toast.success(confirm.kind === 'user' ? `Revoked ${j.revokedDevices ?? 0} device(s)` : 'Revoked successfully');
      setConfirm(null);
      setDetail(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Revoke failed');
    } finally {
      setBusy(false);
    }
  }

  const filtered = devices.filter((d) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (d.deviceName || '').toLowerCase().includes(q) ||
      (d.deviceModel || '').toLowerCase().includes(q) ||
      ownerLabel(d).toLowerCase().includes(q) ||
      d.platform.toLowerCase().includes(q) ||
      (d.lastIp || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">
              <TabletSmartphone className="w-6 h-6 text-primary" /> Device Management
            </h1>
            <p className="text-muted-foreground">Registered mobile devices, sessions, and access control.</p>
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="Search devices…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
            <Button variant="outline" size="icon" onClick={load} title="Refresh"><RefreshCw className="w-4 h-4" /></Button>
          </div>
        </div>
      </FadeIn>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last IP</TableHead>
                <TableHead>Sessions</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">No devices registered.</TableCell></TableRow>
              ) : filtered.map((d) => {
                const Icon = platformIcon(d.platform);
                const sess = newestSession(d);
                const active = d.sessions?.length || 0;
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div>
                          <div className="font-medium">{d.deviceName || d.deviceModel || 'Unknown device'}</div>
                          {d.deviceModel && d.deviceName && <div className="text-xs text-muted-foreground">{d.deviceModel}</div>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{ownerLabel(d)}</TableCell>
                    <TableCell><span className="font-mono text-xs">{d.platform}</span></TableCell>
                    <TableCell className="text-sm">{fmtDateTime(d.lastSeenAt)}</TableCell>
                    <TableCell className="text-sm">{formatDate(d.createdAt)}</TableCell>
                    <TableCell className="text-sm">{sess ? fmtDateTime(sess.expiresAt) : '—'}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[d.status] || 'bg-gray-100 text-gray-700'}`}>{d.status}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.lastIp || '—'}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${active > 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}>{active > 0 ? `${active} active` : 'none'}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm"><MoreHorizontal className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDetail(d)}><Eye className="w-4 h-4 mr-2" /> View</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {sess && (
                            <DropdownMenuItem onClick={() => setConfirm({ kind: 'session', id: sess.id, label: 'this active session' })}>
                              <ShieldOff className="w-4 h-4 mr-2" /> Revoke Session
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-red-600 focus:text-red-600"
                            disabled={d.status === 'REVOKED'}
                            onClick={() => setConfirm({ kind: 'device', id: d.id, label: d.deviceName || d.deviceModel || 'this device' })}
                          >
                            <ShieldOff className="w-4 h-4 mr-2" /> Revoke Device
                          </DropdownMenuItem>
                          {d.user && (
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => setConfirm({ kind: 'user', id: d.user!.id, label: `all devices for ${ownerLabel(d)}` })}
                            >
                              <ShieldOff className="w-4 h-4 mr-2" /> Revoke All User Devices
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Device Details</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <div className="text-muted-foreground">Device Name</div><div className="col-span-2 font-medium">{detail.deviceName || '—'}</div>
                <div className="text-muted-foreground">Model</div><div className="col-span-2">{detail.deviceModel || '—'}</div>
                <div className="text-muted-foreground">Platform</div><div className="col-span-2 font-mono">{detail.platform}</div>
                <div className="text-muted-foreground">OS Version</div><div className="col-span-2">{detail.osVersion || '—'}</div>
                <div className="text-muted-foreground">App Version</div><div className="col-span-2">{detail.appVersion || '—'}</div>
                <div className="text-muted-foreground">User</div><div className="col-span-2">{ownerLabel(detail)}</div>
                <div className="text-muted-foreground">Status</div><div className="col-span-2">{detail.status}</div>
                <div className="text-muted-foreground">Device UUID</div><div className="col-span-2 font-mono text-xs break-all">{detail.deviceUuid}</div>
                <div className="text-muted-foreground">Last Seen</div><div className="col-span-2">{fmtDateTime(detail.lastSeenAt)}</div>
                <div className="text-muted-foreground">Last IP</div><div className="col-span-2 font-mono">{detail.lastIp || '—'}</div>
                <div className="text-muted-foreground">Registered</div><div className="col-span-2">{fmtDateTime(detail.createdAt)}</div>
              </div>
              <div className="border-t pt-3">
                <div className="font-medium mb-2">Active Sessions ({detail.sessions?.length || 0})</div>
                {(!detail.sessions || detail.sessions.length === 0) ? (
                  <p className="text-muted-foreground text-xs">No active sessions.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.sessions.map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded border p-2">
                        <div className="text-xs">
                          <div>Created {fmtDateTime(s.createdAt)}</div>
                          <div className="text-muted-foreground">Expires {fmtDateTime(s.expiresAt)} · Last used {fmtDateTime(s.lastUsedAt)}</div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setConfirm({ kind: 'session', id: s.id, label: 'this session' })}>Revoke</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm revoke */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm revoke</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately revoke {confirm?.label}. Any active tokens will stop working and the device must re-authenticate. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); doRevoke(); }} disabled={busy} className="bg-red-600 hover:bg-red-700">
              {busy ? 'Revoking…' : 'Revoke'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
