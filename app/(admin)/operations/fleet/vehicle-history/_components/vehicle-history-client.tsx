'use client';
// Increment 8 (Workstream N/O) — Logistics History: select vehicle/date/job,
// view stored route history, geofence events, and a timeline playback.
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, MapPin, Flag, AlertTriangle, RefreshCw, Clock, Database } from 'lucide-react';
import { toast } from 'sonner';

const STALE_MS = 24 * 60 * 60 * 1000; // telemetry older than 24h is flagged stale
function fmtSync(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'unknown';
  return d.toLocaleString();
}

const Canvas = dynamic(() => import('./vehicle-history-canvas'), {
  ssr: false, loading: () => <div className="h-full w-full bg-muted animate-pulse rounded-lg" />,
});

function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysAgoISO(n: number) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

export function VehicleHistoryClient() {
  const params = useSearchParams();
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [vehicleId, setVehicleId] = useState<string>(params.get('vehicleId') || '');
  const [from, setFrom] = useState(daysAgoISO(7));
  const [to, setTo] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<{ message: string; reason?: string; status?: number } | null>(null);
  const [loaded, setLoaded] = useState(false); // a load attempt has completed at least once
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    fetch('/api/fleet/vehicles').then((r) => r.json()).then((d) => {
      setVehicles(d.vehicles || []);
      if (!vehicleId && d.vehicles?.[0]) setVehicleId(d.vehicles[0].id);
    }).catch(() => {});
  }, []);

  const run = async () => {
    if (!vehicleId) { toast.error('Select a vehicle'); return; }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to + 'T23:59:59').toISOString() });
      const r = await fetch(`/api/fleet/vehicles/${vehicleId}/history?${qs.toString()}`);
      if (!r.ok) {
        // LOAD FAILURE — surface an operator-safe reason/status, never a silent "no data".
        let reason: string | undefined;
        try { const body = await r.json(); reason = body?.reason || body?.error; } catch { /* non-JSON */ }
        setResult(null);
        setError({ message: 'Unable to load vehicle history.', reason, status: r.status });
        setLoaded(true);
        toast.error('Unable to load vehicle history');
        return;
      }
      const d = await r.json();
      setResult(d); setCursor(0); setLoaded(true);
      if (!d.telemetry?.length) toast.message('No vehicle telemetry recorded for this period');
    } catch (e) {
      // Network / unexpected — also a LOAD FAILURE, distinct from no-data.
      setResult(null);
      setError({ message: 'Unable to load vehicle history.', reason: 'Could not reach the server. Check your connection and try again.' });
      setLoaded(true);
      toast.error('Unable to load vehicle history');
    } finally { setLoading(false); }
  };

  useEffect(() => { if (vehicleId) run(); /* auto-run when vehicle chosen from map */ }, [vehicleId]);

  const tel = result?.telemetry || [];
  const current = tel[cursor];
  const lastSync: string | null = result?.lastSync ?? null;
  const stale = lastSync ? (Date.now() - new Date(lastSync).getTime() > STALE_MS) : false;

  // Shared renderer for the map pane: distinguishes loading / load-failed /
  // no-data / data so an API failure is NEVER shown as "No data".
  function renderPane() {
    if (loading) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Loading vehicle history…</span>
        </div>
      );
    }
    if (error) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-destructive" />
          <div className="font-medium text-destructive">{error.message}</div>
          <div className="text-sm text-muted-foreground max-w-md">
            {error.reason || 'The historical feed could not be loaded.'}
            {error.status ? ` (status ${error.status})` : ''}
          </div>
          <Button variant="outline" size="sm" onClick={run}><RefreshCw className="w-4 h-4 mr-2" />Retry</Button>
        </div>
      );
    }
    if (tel.length) return <Canvas telemetry={tel} cursor={cursor} />;
    if (loaded) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground text-sm">
          <MapPin className="w-8 h-8 opacity-40" />
          <span>No vehicle telemetry was recorded for this period.</span>
          <span className="text-xs">Try a wider date range, or confirm the vehicle’s feed is syncing.</span>
        </div>
      );
    }
    return <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm">Select a vehicle and range, then Load.</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight">Vehicle History</h1>
        <p className="text-muted-foreground">Logistics history from stored fleet telemetry. <Badge variant="secondary">Source: Geotab</Badge></p>
      </div>

      <Card>
        <CardContent className="pt-6 grid gap-3 sm:grid-cols-4 items-end">
          <div><Label>Vehicle</Label>
            <select className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Select…</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}{v.vehicleNumber ? ` (#${v.vehicleNumber})` : ''}</option>)}
            </select>
          </div>
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button onClick={run} disabled={loading}>{loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}Load</Button>
        </CardContent>
      </Card>

      {/* Feed status strip: last sync, record count, staleness. Only meaningful
          after a successful load; hidden while a load error is showing. */}
      {loaded && !error && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Last sync: <span className="font-medium text-foreground">{fmtSync(lastSync)}</span></span>
          <span className="inline-flex items-center gap-1"><Database className="w-3.5 h-3.5" />Telemetry records: <span className="font-medium text-foreground">{result?.count ?? tel.length}</span></span>
          <span>Events: <span className="font-medium text-foreground">{result?.eventCount ?? (result?.events?.length ?? 0)}</span></span>
          <span>Trips: <span className="font-medium text-foreground">{result?.tripCount ?? (result?.trips?.length ?? 0)}</span></span>
          {stale && <Badge variant="outline" className="border-amber-500 text-amber-600">Stale feed — last sample &gt; 24h ago</Badge>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <div style={{ height: '60vh' }}>
              {renderPane()}
            </div>
            {tel.length > 1 && (
              <div className="p-4 border-t space-y-2">
                <input type="range" min={0} max={tel.length - 1} value={cursor} onChange={(e) => setCursor(Number(e.target.value))} className="w-full" />
                <div className="text-sm text-muted-foreground">
                  Point {cursor + 1} / {tel.length}{current ? ` — ${new Date(current.recordedAt).toLocaleString()} — ${current.speed != null ? Math.round(current.speed) + ' mph' : '—'}` : ''}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Arrivals & Departures</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
            {error && <p className="text-sm text-destructive">Unable to load events.</p>}
            {!error && loading && <p className="text-sm text-muted-foreground inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</p>}
            {!error && !loading && (result?.events || []).length === 0 && <p className="text-sm text-muted-foreground">{loaded ? 'No geofence events were recorded for this period.' : 'Load a vehicle to see events.'}</p>}
            {(result?.events || []).map((e: any) => (
              <div key={e.id} className="flex items-start gap-2 text-sm border-b pb-2">
                {e.eventType.includes('ARRIVED') ? <MapPin className="w-4 h-4 text-green-600 mt-0.5" /> : <Flag className="w-4 h-4 text-amber-600 mt-0.5" />}
                <div>
                  <div className="font-medium">{e.eventType.replace('_', ' ')}</div>
                  <div className="text-muted-foreground">{e.job ? `${e.job.jobName} (#${e.job.jobNumber})` : '—'}</div>
                  <div className="text-muted-foreground text-xs">{new Date(e.occurredAt).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
