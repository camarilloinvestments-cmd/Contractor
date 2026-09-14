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
import { Loader2, Search, MapPin, Flag } from 'lucide-react';
import { toast } from 'sonner';

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
    try {
      const qs = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to + 'T23:59:59').toISOString() });
      const r = await fetch(`/api/fleet/vehicles/${vehicleId}/history?${qs.toString()}`);
      if (!r.ok) throw new Error('load failed');
      const d = await r.json();
      setResult(d); setCursor(0);
      if (!d.telemetry?.length) toast.message('No stored telemetry in this range');
    } catch { toast.error('Failed to load history'); } finally { setLoading(false); }
  };

  useEffect(() => { if (vehicleId) run(); /* auto-run when vehicle chosen from map */ }, [vehicleId]);

  const tel = result?.telemetry || [];
  const current = tel[cursor];

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

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <div style={{ height: '60vh' }}>
              {tel.length ? <Canvas telemetry={tel} cursor={cursor} /> : <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm">No route to display</div>}
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
            {(result?.events || []).length === 0 && <p className="text-sm text-muted-foreground">No geofence events in range.</p>}
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
