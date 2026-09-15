'use client';
import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Camera, MapPin, RefreshCw, Eye, Download, Loader2, ExternalLink, PenLine, ShieldCheck } from 'lucide-react';
import { FadeIn } from '@/components/ui/animate';
import { toast } from 'sonner';

type Item = {
  id: string;
  evidenceRef: string;
  status: string;
  jobNumber: string | null;
  jobName: string | null;
  taskCode: string | null;
  taskDescription: string | null;
  technicianName: string | null;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracyMeters: number | null;
  accuracyClass: string | null;
  capturedAt: string | null;
  receivedAt: string | null;
  watermarkGeneratedAt: string | null;
  watermarkError: string | null;
  watermarkedUrl: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  UPLOADED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  WATERMARKED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  SUPERSEDED: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
};
const ACCURACY_COLORS: Record<string, string> = {
  HIGH: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  ACCEPTABLE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  LOW: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '\u2014';
  const d = new Date(v);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}
function fmtCoord(v: number | null | undefined): string {
  return typeof v === 'number' ? v.toFixed(6) : '\u2014';
}

export function FieldPhotoReview({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const [correctOpen, setCorrectOpen] = useState(false);
  const [cLat, setCLat] = useState('');
  const [cLon, setCLon] = useState('');
  const [cReason, setCReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/evidence/photos');
      if (!r.ok) throw new Error();
      const d = await r.json();
      setItems(d.items || []);
    } catch { toast.error('Failed to load field photos'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const r = await fetch(`/api/evidence/photos/${id}`);
      if (!r.ok) throw new Error();
      setDetail(await r.json());
    } catch { toast.error('Failed to load evidence detail'); }
    finally { setDetailLoading(false); }
  };

  const download = async (id: string, variant: 'original' | 'watermarked') => {
    try {
      const r = await fetch(`/api/evidence/photos/${id}?download=${variant}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Download failed');
      const a = document.createElement('a');
      a.href = d.url;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e: any) { toast.error(e?.message || 'Download failed'); }
  };

  const submitCorrection = async () => {
    if (!detail?.record?.id) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/evidence/photos/${detail.record.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correctedLatitude: Number(cLat), correctedLongitude: Number(cLon), correctionReason: cReason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Correction failed');
      toast.success('GPS correction recorded');
      setCorrectOpen(false);
      setCLat(''); setCLon(''); setCReason('');
      setDetail((prev: any) => ({ ...prev, record: d.record }));
      load();
    } catch (e: any) { toast.error(e?.message || 'Correction failed'); }
    finally { setSaving(false); }
  };

  const rec = detail?.record;

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2"><Camera className="w-6 h-6" />Field Photo Evidence</h1>
            <p className="text-muted-foreground">GPS-tagged, watermarked field photos with tamper-evident originals</p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
          </Button>
        </div>
      </FadeIn>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Work Order</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Accuracy</TableHead>
                <TableHead>Captured</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">No field photos captured yet.</TableCell></TableRow>
              ) : items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-mono text-xs">{it.evidenceRef}</TableCell>
                  <TableCell>{it.jobNumber || '\u2014'}</TableCell>
                  <TableCell>{it.taskCode || it.taskDescription || '\u2014'}</TableCell>
                  <TableCell>{it.technicianName || '\u2014'}</TableCell>
                  <TableCell className="font-mono text-xs">{fmtCoord(it.latitude)}, {fmtCoord(it.longitude)}</TableCell>
                  <TableCell>
                    {it.accuracyClass
                      ? <Badge variant="secondary" className={ACCURACY_COLORS[it.accuracyClass] || ''}>{it.accuracyClass}{typeof it.gpsAccuracyMeters === 'number' ? ` \u00b7 ${Math.round(it.gpsAccuracyMeters)}m` : ''}</Badge>
                      : '\u2014'}
                  </TableCell>
                  <TableCell className="text-xs">{fmtDateTime(it.capturedAt)}</TableCell>
                  <TableCell><Badge variant="secondary" className={STATUS_COLORS[it.status] || ''}>{it.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openDetail(it.id)}><Eye className="w-4 h-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5" />Evidence {rec?.evidenceRef || ''}</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : rec ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Watermarked (customer-facing)</p>
                  {detail.watermarkedUrl
                    ? <img src={detail.watermarkedUrl} alt="Watermarked evidence" className="w-full rounded-md border" />
                    : <div className="aspect-video bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground">{rec.watermarkError ? `Watermark failed: ${rec.watermarkError}` : 'Not generated yet'}</div>}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Original {detail.canDownloadOriginal ? '(admin only)' : '(restricted)'}</p>
                  {detail.originalUrl
                    ? <img src={detail.originalUrl} alt="Original evidence" className="w-full rounded-md border" />
                    : <div className="aspect-video bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground">Original preview is restricted</div>}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 text-sm">
                <Field label="Work Order" value={rec.job?.jobNumber} />
                <Field label="Project / Job" value={rec.job?.jobName} />
                <Field label="Task / Billing Code" value={rec.task?.billingCode || rec.task?.description} />
                <Field label="Technician" value={rec.technicianName || rec.capturedBy?.name || rec.capturedBy?.email} />
                <Field label="Latitude" value={fmtCoord(rec.latitude)} mono />
                <Field label="Longitude" value={fmtCoord(rec.longitude)} mono />
                <Field label="GPS Accuracy" value={typeof rec.gpsAccuracyMeters === 'number' ? `${Math.round(rec.gpsAccuracyMeters)} m (${rec.accuracyClass || '\u2014'})` : '\u2014'} />
                <Field label="Address" value={rec.address} />
                <Field label="Captured (field time)" value={fmtDateTime(rec.capturedAt)} />
                <Field label="Received (server)" value={fmtDateTime(rec.receivedAt)} />
                <Field label="Original SHA-256" value={rec.originalSha256} mono small />
                <Field label="Watermarked SHA-256" value={rec.watermarkedSha256} mono small />
              </div>

              {(rec.correctedLatitude != null || rec.correctedLongitude != null) && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm">
                  <p className="font-medium text-amber-700 dark:text-amber-300 mb-1">Administrative GPS correction on record</p>
                  <p className="font-mono text-xs">Corrected: {fmtCoord(rec.correctedLatitude)}, {fmtCoord(rec.correctedLongitude)}</p>
                  <p className="text-xs mt-1">Reason: {rec.correctionReason || '\u2014'} \u00b7 {fmtDateTime(rec.correctedAt)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Captured field values above remain unchanged.</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {typeof rec.latitude === 'number' && typeof rec.longitude === 'number' && (
                  <a href={`https://www.openstreetmap.org/?mlat=${rec.latitude}&mlon=${rec.longitude}#map=18/${rec.latitude}/${rec.longitude}`} target="_blank" rel="noopener">
                    <Button variant="outline" size="sm"><MapPin className="w-4 h-4 mr-2" />View on Map<ExternalLink className="w-3 h-3 ml-1" /></Button>
                  </a>
                )}
                {detail.watermarkedUrl && (
                  <Button variant="outline" size="sm" onClick={() => download(rec.id, 'watermarked')}><Download className="w-4 h-4 mr-2" />Watermarked</Button>
                )}
                {detail.canDownloadOriginal && (
                  <Button variant="outline" size="sm" onClick={() => download(rec.id, 'original')}><Download className="w-4 h-4 mr-2" />Original</Button>
                )}
                {isAdmin && (
                  <Button variant="outline" size="sm" onClick={() => { setCLat(''); setCLon(''); setCReason(''); setCorrectOpen(true); }}><PenLine className="w-4 h-4 mr-2" />Record GPS Correction</Button>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={correctOpen} onOpenChange={setCorrectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record GPS Correction</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This records an administrative correction alongside the original captured coordinates. The captured field values are never overwritten.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Corrected latitude</Label><Input value={cLat} onChange={(e) => setCLat(e.target.value)} placeholder="e.g. 37.774900" /></div>
            <div className="space-y-1"><Label>Corrected longitude</Label><Input value={cLon} onChange={(e) => setCLon(e.target.value)} placeholder="e.g. -122.419400" /></div>
          </div>
          <div className="space-y-1"><Label>Reason (required)</Label><Textarea value={cReason} onChange={(e) => setCReason(e.target.value)} placeholder="Why is this correction being made?" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectOpen(false)}>Cancel</Button>
            <Button onClick={submitCorrection} disabled={saving || !cLat || !cLon || !cReason.trim()}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save Correction</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, mono, small }: { label: string; value?: string | null; mono?: boolean; small?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`${mono ? 'font-mono' : ''} ${small ? 'text-[10px] break-all' : 'text-sm'}`}>{value || '\u2014'}</p>
    </div>
  );
}
