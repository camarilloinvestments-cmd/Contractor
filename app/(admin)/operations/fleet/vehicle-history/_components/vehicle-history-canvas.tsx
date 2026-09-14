'use client';
// Increment 8 (Workstream N/O) — route history playback canvas (Leaflet).
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useMemo } from 'react';

function dot(color: string) {
  return L.divIcon({
    className: 'os1-dot',
    html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
    iconSize: [14, 14], iconAnchor: [7, 7], popupAnchor: [0, -8],
  });
}

export default function VehicleHistoryCanvas({
  telemetry,
  cursor,
}: {
  telemetry: any[];
  cursor: number;
}) {
  const points = useMemo(() => (telemetry || []).map((t) => [t.latitude, t.longitude] as [number, number]), [telemetry]);
  const center = points[0] || [36.7378, -119.7871];
  const current = telemetry?.[cursor];

  return (
    <div className="h-full w-full">
      <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" subdomains={['a', 'b', 'c']} maxZoom={19} />
        {points.length > 1 && <Polyline positions={points} pathOptions={{ color: '#0891b2', weight: 3, opacity: 0.7 }} />}
        {points[0] && <Marker position={points[0]} icon={dot('#059669')}><Popup>Start</Popup></Marker>}
        {points.length > 1 && <Marker position={points[points.length - 1]} icon={dot('#dc2626')}><Popup>End</Popup></Marker>}
        {current && (
          <Circle center={[current.latitude, current.longitude]} radius={40} pathOptions={{ color: '#1e40af', fillColor: '#1e40af', fillOpacity: 0.6, weight: 2 }} />
        )}
      </MapContainer>
    </div>
  );
}
