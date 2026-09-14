'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardCheck, MoreHorizontal, CheckCircle2, XCircle, Eye, MapPin, Briefcase, HardHat, FileText, Image as ImageIcon, RefreshCw, PenLine } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDate } from '@/lib/utils/format';
import { FadeIn } from '@/components/ui/animate';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  ACCEPTED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  FLAGGED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};
const GEOFENCE_COLORS: Record<string, string> = {
  INSIDE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  OUTSIDE: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  UNKNOWN: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
};

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

type Asset = { id: string; kind: string; cloudStoragePath: string; contentType: string | null; fileName: string | null };
type Pkg = {
  id: string;
  jobId: string;
  taskId: string | null;
  workerId: string | null;
  crewId: string | null;
  subcontractorName: string | null;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracyMeters: number | null;
  geofenceStatus: string;
  geofenceDistanceFeet: number | null;
  productionQuantity: number | null;
  productionUnit: string | null;
  notes: string | null;
  signatureStoragePath: string | null;
  signedByName: string | null;
  capturedAt: string | null;
  submittedAt: string;
  status: string;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  assets: Asset[];
  job: { jobNumber: string; jobName: string } | null;
  worker: { name: string; companyName: string | null } | null;
  task: { description: string } | null;
};

export function EvidenceContent() {
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Pkg | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [reject, setReject] = useState<Pkg | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const res = await fetch(`/api/evidence?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load evidence');
      const data = await res.json();
      setPackages(data.packages || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load evidence');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [statusFilter]);

  async function openDetail(p: Pkg) {
    setDetail(p);
    setAssetUrls({});
    // Fetch full detail with server-resolved signed URLs (never stored client-side).
    try {
      const res = await fetch(`/api/evidence/${p.id}`);
      if (res.ok) {
        const j = await res.json();
        const resolved: Record<string, string> = { ...(j.assetUrls || {}) };
        if (j.signatureUrl) resolved['signature'] = j.signatureUrl;
        setAssetUrls(resolved);
        if (j.package) setDetail((prev) => (prev && prev.id === p.id ? { ...prev, ...j.package } : prev));
      }
    } catch { /* ignore */ }
  }

  async function review(p: Pkg, action: 'APPROVE' | 'REJECT', note?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/evidence/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: note || '' }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Review failed');
      }
      toast.success(action === 'APPROVE' ? 'Evidence approved' : 'Returned for correction');
      setReject(null);
      setRejectNote('');
      setDetail(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Review failed');
    } finally {
      setBusy(false);
    }
  }

  function workerLabel(p: Pkg): string {
    if (p.worker) return p.worker.name + (p.worker.companyName ? ` (${p.worker.companyName})` : '');
    return '—';
  }

  const filtered = packages.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (p.job?.jobNumber || '').toLowerCase().includes(q) ||
      (p.job?.jobName || '').toLowerCase().includes(q) ||
      workerLabel(p).toLowerCase().includes(q) ||
      (p.subcontractorName || '').toLowerCase().includes(q) ||
      (p.task?.description || '').toLowerCase().includes(q)
    );
  });

  const photos = (p: Pkg) => p.assets.filter((a) => a.kind === 'PHOTO');
  const docs = (p: Pkg) => p.assets.filter((a) => a.kind !== 'PHOTO');

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">
              <ClipboardCheck className="w-6 h-6 text-primary" /> Evidence Review
            </h1>
            <p className="text-muted-foreground">Review, approve, or return field evidence submissions.</p>
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="SUBMITTED">Submitted</SelectItem>
                <SelectItem value="ACCEPTED">Accepted</SelectItem>
                <SelectItem value="FLAGGED">Flagged</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={load} title="Refresh"><RefreshCw className="w-4 h-4" /></Button>
          </div>
        </div>
      </FadeIn>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Worker / Sub</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Geofence</TableHead>
                <TableHead>Production</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">No evidence submissions.</TableCell></TableRow>
              ) : filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-medium font-mono text-xs">{p.job?.jobNumber || '—'}</div>
                    <div className="text-xs text-muted-foreground">{p.job?.jobName || ''}</div>
                  </TableCell>
                  <TableCell className="text-sm max-w-[160px] truncate">{p.task?.description || '—'}</TableCell>
                  <TableCell className="text-sm">{p.worker ? workerLabel(p) : (p.subcontractorName || '—')}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5" />{photos(p).length}</span>
                      <span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" />{docs(p).length}</span>
                      {p.signatureStoragePath && <PenLine className="w-3.5 h-3.5 text-muted-foreground" />}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${GEOFENCE_COLORS[p.geofenceStatus] || 'bg-gray-100 text-gray-700'}`}>
                      {p.geofenceStatus}{p.geofenceDistanceFeet != null ? ` · ${Math.round(p.geofenceDistanceFeet)}ft` : ''}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{p.productionQuantity != null ? `${p.productionQuantity}${p.productionUnit ? ' ' + p.productionUnit : ''}` : '—'}</TableCell>
                  <TableCell className="text-sm">{fmtDateTime(p.submittedAt)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[p.status] || 'bg-gray-100 text-gray-700'}`}>{p.status}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm"><MoreHorizontal className="w-4 h-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openDetail(p)}><Eye className="w-4 h-4 mr-2" /> View Details</DropdownMenuItem>
                        {p.jobId && <DropdownMenuItem asChild><a href={`/jobs/${p.jobId}`}><Briefcase className="w-4 h-4 mr-2" /> View Job</a></DropdownMenuItem>}
                        {p.workerId && <DropdownMenuItem asChild><a href={`/workers/${p.workerId}`}><HardHat className="w-4 h-4 mr-2" /> View Worker</a></DropdownMenuItem>}
                        {p.latitude != null && p.longitude != null && (
                          <DropdownMenuItem asChild>
                            <a href={`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`} target="_blank" rel="noopener noreferrer"><MapPin className="w-4 h-4 mr-2" /> View Location</a>
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={p.status === 'ACCEPTED'} onClick={() => review(p, 'APPROVE')}><CheckCircle2 className="w-4 h-4 mr-2 text-green-600" /> Approve</DropdownMenuItem>
                        <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => { setReject(p); setRejectNote(''); }}><XCircle className="w-4 h-4 mr-2" /> Return for Correction</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Evidence Package — {detail?.job?.jobNumber}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <div className="text-muted-foreground">Job</div><div className="col-span-2">{detail.job?.jobNumber} — {detail.job?.jobName}</div>
                <div className="text-muted-foreground">Task</div><div className="col-span-2">{detail.task?.description || '—'}</div>
                <div className="text-muted-foreground">Worker</div><div className="col-span-2">{workerLabel(detail)}</div>
                <div className="text-muted-foreground">Subcontractor</div><div className="col-span-2">{detail.subcontractorName || '—'}</div>
                <div className="text-muted-foreground">GPS</div><div className="col-span-2">{detail.latitude != null && detail.longitude != null ? `${detail.latitude.toFixed(6)}, ${detail.longitude.toFixed(6)}${detail.gpsAccuracyMeters != null ? ` (±${Math.round(detail.gpsAccuracyMeters)}m)` : ''}` : 'Not captured'}</div>
                <div className="text-muted-foreground">Geofence</div><div className="col-span-2"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${GEOFENCE_COLORS[detail.geofenceStatus] || 'bg-gray-100 text-gray-700'}`}>{detail.geofenceStatus}{detail.geofenceDistanceFeet != null ? ` · ${Math.round(detail.geofenceDistanceFeet)}ft` : ''}</span></div>
                <div className="text-muted-foreground">Production</div><div className="col-span-2">{detail.productionQuantity != null ? `${detail.productionQuantity}${detail.productionUnit ? ' ' + detail.productionUnit : ''}` : '—'}</div>
                <div className="text-muted-foreground">Captured</div><div className="col-span-2">{fmtDateTime(detail.capturedAt)}</div>
                <div className="text-muted-foreground">Submitted</div><div className="col-span-2">{fmtDateTime(detail.submittedAt)}</div>
                <div className="text-muted-foreground">Status</div><div className="col-span-2"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[detail.status] || 'bg-gray-100 text-gray-700'}`}>{detail.status}</span></div>
                {detail.notes && (<><div className="text-muted-foreground">Notes</div><div className="col-span-2 whitespace-pre-wrap">{detail.notes}</div></>)}
                {detail.reviewNote && (<><div className="text-muted-foreground">Review Note</div><div className="col-span-2 whitespace-pre-wrap">{detail.reviewNote}</div></>)}
              </div>

              {photos(detail).length > 0 && (
                <div>
                  <div className="font-medium mb-2">Photos ({photos(detail).length})</div>
                  <div className="grid grid-cols-3 gap-2">
                    {photos(detail).map((a) => (
                      <a key={a.id} href={assetUrls[a.id] || '#'} target="_blank" rel="noopener noreferrer" className="block aspect-video bg-muted rounded overflow-hidden relative">
                        {assetUrls[a.id] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={assetUrls[a.id]} alt={a.fileName || 'Evidence photo'} className="object-cover w-full h-full" />
                        ) : (
                          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">Loading…</div>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {docs(detail).length > 0 && (
                <div>
                  <div className="font-medium mb-2">Documents ({docs(detail).length})</div>
                  <div className="space-y-1">
                    {docs(detail).map((a) => (
                      <a key={a.id} href={assetUrls[a.id] || '#'} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline text-sm">
                        <FileText className="w-4 h-4" /> {a.fileName || a.kind}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {detail.signatureStoragePath && (
                <div>
                  <div className="font-medium mb-2">Signature{detail.signedByName ? ` — ${detail.signedByName}` : ''}</div>
                  <div className="border rounded p-2 bg-white inline-block">
                    {assetUrls['signature'] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={assetUrls['signature']} alt="Signature" className="max-h-24" />
                    ) : (
                      <div className="text-xs text-muted-foreground">Loading…</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            {detail && detail.latitude != null && detail.longitude != null && (
              <Button variant="outline" asChild>
                <a href={`https://www.google.com/maps/search/?api=1&query=${detail.latitude},${detail.longitude}`} target="_blank" rel="noopener noreferrer"><MapPin className="w-4 h-4 mr-2" /> Location</a>
              </Button>
            )}
            {detail && (
              <>
                <Button variant="outline" className="text-red-600" disabled={busy} onClick={() => { setReject(detail); setRejectNote(''); }}>
                  <XCircle className="w-4 h-4 mr-2" /> Return for Correction
                </Button>
                <Button disabled={busy || detail.status === 'ACCEPTED'} onClick={() => review(detail, 'APPROVE')} className="bg-green-600 hover:bg-green-700">
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!reject} onOpenChange={(o) => !o && setReject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return Evidence for Correction</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">This flags the evidence and returns it to the field worker for correction. A reason is required.</p>
            <div>
              <Label htmlFor="reject-note">Reason / correction requested</Label>
              <Textarea id="reject-note" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={4} placeholder="Describe what needs to be corrected…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReject(null)} disabled={busy}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" disabled={busy || !rejectNote.trim()} onClick={() => reject && review(reject, 'REJECT', rejectNote.trim())}>
              {busy ? 'Submitting…' : 'Return for Correction'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
