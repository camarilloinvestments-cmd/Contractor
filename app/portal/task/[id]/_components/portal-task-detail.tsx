'use client';
import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/status-badge';
import { ArrowLeft, Play, Camera, FileUp, MessageSquare, Send, MapPin, AlertTriangle, Loader2, ShieldCheck, WifiOff, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { FadeIn } from '@/components/ui/animate';
import { formatDate } from '@/lib/utils/format';
import {
  enqueueEvidence, listQueue, processQueue, pendingCount,
  type QueuedEvidence, type QueueStatus,
} from '@/lib/evidence/offline-queue';

interface GpsData {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
}

export function PortalTaskDetail({ id }: { id: string }) {
  const [task, setTask] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [gps, setGps] = useState<GpsData>({ latitude: null, longitude: null, accuracy: null });
  const [gpsLoading, setGpsLoading] = useState(false);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [evidenceQueue, setEvidenceQueue] = useState<QueuedEvidence[]>([]);
  const [queueProcessing, setQueueProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(() => {
    Promise.all([
      fetch(`/api/jobs/placeholder/tasks`).then(() => null), // placeholder
    ]).catch(() => null);

    // Fetch task from job
    fetch('/api/portal/jobs').then(r => r.json()).then((jobs: any[]) => {
      for (const job of (jobs ?? [])) {
        const found = (job?.tasks ?? []).find((t: any) => t?.id === id);
        if (found) {
          setTask({ ...found, job });
          break;
        }
      }
    }).catch(console.error).finally(() => setLoading(false));

    fetch(`/api/portal/activity?taskId=${id}`).then(r => r.json()).then(setActivities).catch(console.error);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const captureGps = useCallback(() => {
    if (!navigator?.geolocation) {
      toast.error('GPS not available on this device');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          latitude: pos?.coords?.latitude ?? null,
          longitude: pos?.coords?.longitude ?? null,
          accuracy: pos?.coords?.accuracy ?? null,
        });
        setGpsLoading(false);
      },
      (err) => {
        console.error('GPS error:', err);
        toast.error('Failed to get GPS location. Please enable location access.');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }, []);

  useEffect(() => { captureGps(); }, [captureGps]);

  // Promise-based fresh GPS read for evidence capture (does not rely on state).
  const getFreshGps = useCallback((): Promise<{ latitude: number | null; longitude: number | null; accuracy: number | null; altitude: number | null; heading: number | null; speed: number | null; timestamp: number | null }> => {
    return new Promise((resolve) => {
      if (!navigator?.geolocation) {
        resolve({ latitude: null, longitude: null, accuracy: null, altitude: null, heading: null, speed: null, timestamp: null });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          latitude: pos?.coords?.latitude ?? null,
          longitude: pos?.coords?.longitude ?? null,
          accuracy: pos?.coords?.accuracy ?? null,
          altitude: pos?.coords?.altitude ?? null,
          heading: pos?.coords?.heading ?? null,
          speed: pos?.coords?.speed ?? null,
          timestamp: pos?.timestamp ?? Date.now(),
        }),
        () => resolve({ latitude: null, longitude: null, accuracy: null, altitude: null, heading: null, speed: null, timestamp: null }),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
  }, []);

  // Load evidence queue from IndexedDB on mount.
  const refreshQueue = useCallback(async () => {
    try {
      const all = await listQueue();
      setEvidenceQueue(all.filter(q => q.taskId === id));
    } catch { /* IDB unavailable */ }
  }, [id]);
  useEffect(() => { refreshQueue(); }, [refreshQueue]);

  // Auto-process queue when connectivity returns.
  useEffect(() => {
    const handler = async () => {
      if (!navigator.onLine) return;
      const count = await pendingCount();
      if (count > 0) {
        setQueueProcessing(true);
        const ok = await processQueue();
        if (ok > 0) { toast.success(`${ok} queued evidence photo(s) uploaded`); fetchData(); }
        await refreshQueue();
        setQueueProcessing(false);
      }
    };
    window.addEventListener('online', handler);
    // Also try once on mount.
    handler();
    return () => window.removeEventListener('online', handler);
  }, [refreshQueue, fetchData]);

  const handleRetryQueue = async () => {
    setQueueProcessing(true);
    const ok = await processQueue();
    if (ok > 0) { toast.success(`${ok} evidence photo(s) uploaded`); fetchData(); }
    else toast.info('No items processed — check connectivity');
    await refreshQueue();
    setQueueProcessing(false);
  };

  // Tamper-evident field photo evidence: capture fresh GPS, queue to IndexedDB,
  // then attempt reserve → upload → register. If offline/failed, item stays
  // queued and will be retried automatically or manually.
  const handleEvidencePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e?.target?.files?.[0];
    if (e?.target) e.target.value = '';
    if (!file) return;
    if (!task?.job?.id) { toast.error('Work order not loaded yet'); return; }
    setEvidenceUploading(true);
    const localUuid = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const capturedAt = new Date().toISOString();
    try {
      const fresh = await getFreshGps();
      setGps({ latitude: fresh.latitude, longitude: fresh.longitude, accuracy: fresh.accuracy });

      // §4: Immediately persist to IndexedDB (survives page close / poor signal).
      const queued = await enqueueEvidence({
        localUuid,
        photoBlob: file,
        fileName: file.name,
        contentType: file.type || 'image/jpeg',
        capturedAt,
        locationCapturedAt: fresh.timestamp ? new Date(fresh.timestamp).toISOString() : null,
        latitude: fresh.latitude,
        longitude: fresh.longitude,
        gpsAccuracyMeters: fresh.accuracy,
        altitude: fresh.altitude,
        heading: fresh.heading,
        speed: fresh.speed,
        jobId: task.job.id,
        taskId: id,
      });
      toast.info('Evidence photo queued locally');
      await refreshQueue();

      // Attempt immediate upload if online.
      if (navigator.onLine) {
        const { processQueueItem } = await import('@/lib/evidence/offline-queue');
        const success = await processQueueItem(queued);
        if (success) {
          toast.success('Evidence photo captured and uploaded');
          fetchData();
        } else {
          // Refresh to show updated status (FAILED with message).
          toast.warning('Photo saved locally — upload will retry when connected');
        }
      } else {
        toast.warning('Offline — photo saved locally and will upload when connected');
      }
      await refreshQueue();
    } catch (err: any) {
      console.error('Evidence capture error:', err);
      toast.error(err?.message || 'Evidence capture failed');
    } finally {
      setEvidenceUploading(false);
    }
  };

  const handleStartTask = async () => {
    try {
      const res = await fetch(`/api/portal/tasks/${id}/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: gps.latitude, longitude: gps.longitude, gpsAccuracy: gps.accuracy }),
      });
      const data = await res.json();
      if (data?.proximityWarning) {
        toast.warning(`You are ${data?.distanceFromJob ?? '?'}ft from the job site`);
      }
      toast.success('Task started');
      fetchData();
    } catch { toast.error('Failed to start task'); }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'PHOTO' | 'DOCUMENT') => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // Capture fresh GPS
      captureGps();

      // Get presigned URL
      const presignRes = await fetch('/api/upload/presigned', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, isPublic: false }),
      });
      const { uploadUrl, cloud_storage_path } = await presignRes.json();

      // Upload to S3
      await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });

      // Log activity
      await fetch('/api/portal/activity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: task?.job?.id,
          taskId: id,
          activityType: type,
          description: `${type === 'PHOTO' ? 'Photo' : 'Document'} uploaded: ${file.name}`,
          cloudStoragePath: cloud_storage_path,
          isPublic: false,
          contentType: file.type,
          fileName: file.name,
          latitude: gps.latitude,
          longitude: gps.longitude,
          gpsAccuracy: gps.accuracy,
        }),
      });

      toast.success(`${type === 'PHOTO' ? 'Photo' : 'Document'} uploaded`);
      fetchData();
    } catch (err) {
      console.error('Upload error:', err);
      toast.error('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleAddNote = async () => {
    if (!note.trim()) return;
    try {
      await fetch('/api/portal/activity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: task?.job?.id,
          taskId: id,
          activityType: 'NOTE',
          description: note,
          latitude: gps.latitude,
          longitude: gps.longitude,
          gpsAccuracy: gps.accuracy,
        }),
      });
      toast.success('Note added');
      setNote('');
      fetchData();
    } catch { toast.error('Failed to add note'); }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await fetch(`/api/portal/tasks/${id}/submit`, { method: 'POST' });
      toast.success('Task submitted for review');
      fetchData();
    } catch { toast.error('Failed to submit'); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div className="max-w-lg mx-auto p-4"><div className="h-96 bg-muted animate-pulse rounded-lg" /></div>;

  const canSubmit = task?.status === 'IN_PROGRESS';
  const canStart = task?.status === 'PENDING';

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <FadeIn>
        <div className="flex items-center gap-3">
          <Link href={task?.job?.id ? `/portal/job/${task.job.id}` : '/portal'}><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div>
            <h1 className="text-lg font-display font-bold tracking-tight">{task?.taskType?.name ?? 'Task'}</h1>
            <div className="flex items-center gap-2">
              <StatusBadge status={task?.status} />
              <span className="text-xs text-muted-foreground">{task?.quantity ?? 0} {task?.taskType?.unitOfMeasure ?? ''}</span>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* GPS Status */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className={`w-4 h-4 ${gps.latitude ? 'text-green-600' : 'text-muted-foreground'}`} />
              {gps.latitude ? (
                <span className="text-xs font-mono">{gps.latitude.toFixed(6)}, {gps.longitude?.toFixed(6)} (±{Math.round(gps.accuracy ?? 0)}m)</span>
              ) : (
                <span className="text-xs text-muted-foreground">{gpsLoading ? 'Acquiring GPS...' : 'GPS not available'}</span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={captureGps} disabled={gpsLoading}>
              {gpsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {task?.description && (
        <Card>
          <CardContent className="py-3">
            <p className="text-sm"><span className="font-medium">Instructions: </span>{task.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="space-y-3">
        {canStart && (
          <Button onClick={handleStartTask} className="w-full h-14 text-lg" size="lg">
            <Play className="w-5 h-5 mr-2" />Start Task
          </Button>
        )}

        {task?.status === 'IN_PROGRESS' && (
          <>
            <label className="cursor-pointer block">
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleEvidencePhoto} disabled={evidenceUploading || uploading} />
              <div className="flex flex-col items-center justify-center gap-2 p-5 bg-primary/10 rounded-lg border-2 border-primary/40 hover:border-primary transition-colors">
                <ShieldCheck className="w-8 h-8 text-primary" />
                <span className="text-sm font-semibold">Take Evidence Photo</span>
                <span className="text-[11px] text-muted-foreground text-center">GPS-tagged &amp; watermarked. Original preserved.</span>
              </div>
            </label>

            {evidenceUploading && <div className="text-center py-2"><Loader2 className="w-5 h-5 animate-spin mx-auto" /><p className="text-xs text-muted-foreground">Capturing evidence...</p></div>}

            {/* Offline evidence queue status */}
            {evidenceQueue.filter(q => q.status !== 'UPLOADED').length > 0 && (
              <Card className="border-amber-400/50 bg-amber-50 dark:bg-amber-950/20">
                <CardContent className="py-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <WifiOff className="w-4 h-4 text-amber-600" />
                      <span>{evidenceQueue.filter(q => q.status === 'PENDING_UPLOAD' || q.status === 'FAILED').length} pending evidence photo(s)</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleRetryQueue} disabled={queueProcessing}>
                      {queueProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      <span className="ml-1 text-xs">Retry</span>
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {evidenceQueue.filter(q => q.status !== 'UPLOADED').map(q => (
                      <div key={q.localUuid} className="flex items-center justify-between text-xs">
                        <span className="truncate max-w-[60%]">{q.fileName}</span>
                        <span className={q.status === 'FAILED' ? 'text-red-600' : q.status === 'UPLOADING' ? 'text-blue-600' : 'text-amber-600'}>{q.status.replace('_', ' ')}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="cursor-pointer">
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e: any) => handleUpload(e, 'PHOTO')} disabled={uploading} />
                <div className="flex flex-col items-center justify-center gap-2 p-4 bg-muted/50 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors">
                  <Camera className="w-8 h-8 text-primary" />
                  <span className="text-sm font-medium">Quick Photo</span>
                </div>
              </label>
              <label className="cursor-pointer">
                <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={(e: any) => handleUpload(e, 'DOCUMENT')} disabled={uploading} />
                <div className="flex flex-col items-center justify-center gap-2 p-4 bg-muted/50 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors">
                  <FileUp className="w-8 h-8 text-primary" />
                  <span className="text-sm font-medium">Upload Doc</span>
                </div>
              </label>
            </div>

            {uploading && <div className="text-center py-2"><Loader2 className="w-5 h-5 animate-spin mx-auto" /><p className="text-xs text-muted-foreground">Uploading...</p></div>}

            <Card>
              <CardContent className="py-3">
                <div className="flex gap-2">
                  <Textarea placeholder="Add a note..." value={note} onChange={(e: any) => setNote(e.target.value)} className="min-h-[60px]" />
                  <Button size="icon" onClick={handleAddNote} disabled={!note.trim()}><MessageSquare className="w-4 h-4" /></Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {canSubmit && (
          <Button onClick={handleSubmit} className="w-full h-14 text-lg bg-green-600 hover:bg-green-700" size="lg" disabled={submitting}>
            <Send className="w-5 h-5 mr-2" />Submit for Review
          </Button>
        )}
      </div>

      {/* Activity Feed */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">ACTIVITY</h2>
        <div className="space-y-2">
          {(activities ?? []).map((a: any) => (
            <Card key={a?.id}>
              <CardContent className="py-3">
                <div className="flex gap-2">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    {a?.activityType === 'PHOTO' ? '📷' : a?.activityType === 'DOCUMENT' ? '📄' : a?.activityType === 'NOTE' ? '📝' : a?.activityType === 'CHECK_IN' ? '📍' : '🔄'}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm">{a?.description ?? a?.activityType ?? ''}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(a?.createdAt)}
                      {a?.distanceFromJob != null ? ` · ${a.distanceFromJob}ft from site` : ''}
                    </p>
                    {a?.proximityWarning && (
                      <div className="flex items-center gap-1 text-xs text-amber-600 mt-1"><AlertTriangle className="w-3 h-3" />Far from job site</div>
                    )}
                    {a?.fileUrl && a?.activityType === 'PHOTO' && (
                      <img src={a.fileUrl} alt="Upload" className="mt-2 rounded-lg max-h-40 object-cover" />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {(activities?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground text-center py-4">No activity yet</p>}
        </div>
      </div>
    </div>
  );
}
