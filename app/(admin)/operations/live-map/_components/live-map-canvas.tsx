'use client';
// Increment 8 (Workstream N) — Leaflet canvas for the Live Operations Map.
// Loaded only in the browser (via next/dynamic ssr:false from the client panel)
// so it is safe to import leaflet directly here.
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';
import { useMemo } from 'react';

export type LiveLayers = { jobs: boolean; workers: boolean; subcontractors: boolean; crews: boolean; trucks: boolean };

function pin(color: string, glyph: string) {
  return L.divIcon({
    className: 'os1-pin',
    html: `<div style="background:${color};width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;border:2px solid #fff"><span style="transform:rotate(45deg);font-size:13px;line-height:1">${glyph}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -26],
  });
}

const ICONS = {
  job: () => pin('#1e40af', '📍'),
  worker: () => pin('#059669', '👷'),
  sub: () => pin('#7c3aed', '🧰'),
  truckLive: () => pin('#0891b2', '🚚'),
  truckStale: () => pin('#9ca3af', '🚚'),
};

function feetToMeters(ft: number) { return ft * 0.3048; }

export default function LiveMapCanvas({
  data,
  layers,
  onVehicleAction,
}: {
  data: any;
  layers: LiveLayers;
  onVehicleAction: (action: string, vehicle: any) => void;
}) {
  const center = useMemo<[number, number]>(() => {
    const j = (data?.jobs || [])[0];
    if (j) return [j.latitude, j.longitude];
    const v = (data?.vehicles || [])[0];
    if (v) return [v.latitude, v.longitude];
    return [36.7378, -119.7871];
  }, [data]);

  return (
    <div className="h-full w-full">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://upload.wikimedia.org/wikipedia/commons/0/03/Tiled_web_map_Stevage.png?utm_source=en.wikipedia.org&utm_campaign=index&utm_content=original" />

        {layers.jobs && (data?.jobs || []).map((j: any) => (
          <div key={`job-${j.id}`}>
            <Marker position={[j.latitude, j.longitude]} icon={ICONS.job()}>
              <Popup>
                <div className="text-sm"><div className="font-semibold">{j.jobName}</div>
                  <div className="text-muted-foreground">#{j.jobNumber} — {j.status}</div>
                  {(j.address || j.city) && <div>{[j.address, j.city, j.state].filter(Boolean).join(', ')}</div>}
                </div>
              </Popup>
            </Marker>
            <Circle center={[j.latitude, j.longitude]} radius={feetToMeters(j.geofenceRadiusFeet ?? 500)} pathOptions={{ color: '#1e40af', fillOpacity: 0.05, weight: 1 }} />
          </div>
        ))}

        {layers.workers && (data?.workers || []).map((w: any) => (
          <Marker key={`wk-${w.id}`} position={[w.latitude, w.longitude]} icon={w.workerType === 'SUBCONTRACTOR' && layers.subcontractors ? ICONS.sub() : ICONS.worker()}>
            <Popup>
              <div className="text-sm"><div className="font-semibold">{w.name}</div>
                <div className="text-muted-foreground">{w.workerType}{w.companyName ? ` — ${w.companyName}` : ''}</div>
                <div>Source: Mobile App</div>
                {w.stale && <div style={{ color: '#b45309' }}>Stale (no recent GPS)</div>}
              </div>
            </Popup>
          </Marker>
        ))}

        {layers.trucks && (data?.vehicles || []).map((v: any) => (
          <Marker key={`veh-${v.id}`} position={[v.latitude, v.longitude]} icon={v.stale ? ICONS.truckStale() : ICONS.truckLive()}>
            <Popup>
              <div className="text-sm space-y-0.5" style={{ minWidth: 200 }}>
                <div className="font-semibold">{v.name}{v.vehicleNumber ? ` (#${v.vehicleNumber})` : ''}</div>
                <div>Driver: {v.driverName || '—'}</div>
                <div>Crew: {v.crew?.name || '—'}</div>
                <div>Job: {v.currentJob ? `${v.currentJob.jobName}` : '—'}</div>
                <div>Speed: {v.speed != null ? `${Math.round(v.speed)} mph` : '—'} — {v.motion}</div>
                <div>Comms: {v.communicating ? 'online' : 'offline'}</div>
                <div>Last GPS: {v.recordedAt ? new Date(v.recordedAt).toLocaleString() : '—'}</div>
                <div>Age: {v.lastUpdateAgeSeconds != null ? `${v.lastUpdateAgeSeconds}s` : '—'}{v.stale ? ' (STALE)' : ''}</div>
                <div>Coords: {v.latitude.toFixed(5)}, {v.longitude.toFixed(5)}</div>
                <div>Source: Geotab</div>
                <div className="flex flex-wrap gap-1 pt-1">
                  <button className="px-2 py-0.5 text-xs rounded bg-slate-800 text-white" onClick={() => onVehicleAction('view', v)}>View Vehicle</button>
                  <button className="px-2 py-0.5 text-xs rounded bg-slate-800 text-white" onClick={() => onVehicleAction('job', v)}>Current Job</button>
                  <button className="px-2 py-0.5 text-xs rounded bg-slate-800 text-white" onClick={() => onVehicleAction('history', v)}>History</button>
                  <button className="px-2 py-0.5 text-xs rounded bg-slate-800 text-white" onClick={() => onVehicleAction('route', v)}>Today's Route</button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
