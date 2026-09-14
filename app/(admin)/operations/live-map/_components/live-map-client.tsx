'use client';
// Increment 8 (Workstream N) — Live Operations Map control panel + polling.
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, MapPin, HardHat, Package, Users, Truck } from 'lucide-react';
import { toast } from 'sonner';
import type { LiveLayers } from './live-map-canvas';

const LiveMapCanvas = dynamic(() => import('./live-map-canvas'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-muted animate-pulse rounded-lg" />,
});

export function LiveMapClient() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [layers, setLayers] = useState<LiveLayers>({ jobs: true, workers: true, subcontractors: true, crews: true, trucks: true });
  const timer = useRef<any>(null);

  const load = async () => {
    try {
      const r = await fetch('/api/live-map', { cache: 'no-store' });
      if (!r.ok) throw new Error('load failed');
      setData(await r.json());
    } catch { /* keep last-known data on transient failure */ } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    timer.current = setInterval(load, 15000);
    return () => clearInterval(timer.current);
  }, []);

  const onVehicleAction = (action: string, v: any) => {
    if (action === 'history' || action === 'route') {
      router.push(`/operations/fleet/vehicle-history?vehicleId=${v.id}`);
    } else if (action === 'job' && v.currentJob?.id) {
      router.push(`/jobs/${v.currentJob.id}`);
    } else if (action === 'view') {
      toast.message(`${v.name}`, { description: `Driver ${v.driverName || '—'} — ${v.motion}` });
    } else {
      toast.message('No current job assigned');
    }
  };

  const toggle = (k: keyof LiveLayers) => setLayers((p) => ({ ...p, [k]: !p[k] }));
  const LayerBtn = ({ k, label, Icon }: { k: keyof LiveLayers; label: string; Icon: any }) => (
    <Button variant={layers[k] ? 'default' : 'outline'} size="sm" onClick={() => toggle(k)}>
      <Icon className="w-4 h-4 mr-1" />{label}
    </Button>
  );

  const counts = {
    jobs: data?.jobs?.length ?? 0,
    workers: data?.workers?.length ?? 0,
    trucks: data?.vehicles?.length ?? 0,
    staleTrucks: (data?.vehicles || []).filter((v: any) => v.stale).length,
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Live Operations Map</h1>
          <p className="text-muted-foreground">Job sites, workers (mobile GPS) and trucks (Geotab GPS) — separate streams, auto-refreshing.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <LayerBtn k="jobs" label="Job Sites" Icon={MapPin} />
        <LayerBtn k="workers" label="Workers" Icon={HardHat} />
        <LayerBtn k="subcontractors" label="Subcontractors" Icon={Package} />
        <LayerBtn k="crews" label="Crews" Icon={Users} />
        <LayerBtn k="trucks" label="Trucks" Icon={Truck} />
        <div className="ml-auto flex items-center gap-2 text-xs">
          <Badge variant="secondary">{counts.jobs} jobs</Badge>
          <Badge variant="secondary">{counts.workers} workers</Badge>
          <Badge variant="secondary">{counts.trucks} trucks</Badge>
          {counts.staleTrucks > 0 && <Badge variant="secondary">{counts.staleTrucks} stale</Badge>}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div style={{ height: '70vh' }} className="relative">
            {loading && !data ? (
              <div className="h-full w-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <LiveMapCanvas data={data} layers={layers} onVehicleAction={onVehicleAction} />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
