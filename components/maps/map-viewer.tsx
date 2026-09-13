'use client';
import dynamic from 'next/dynamic';
import { useMemo } from 'react';

const MapContainer = dynamic(
  () => import('react-leaflet').then(mod => mod.MapContainer),
  { ssr: false, loading: () => <div className="h-full w-full bg-muted animate-pulse rounded-lg" /> }
);
const TileLayer = dynamic(
  () => import('react-leaflet').then(mod => mod.TileLayer),
  { ssr: false }
);
const Marker = dynamic(
  () => import('react-leaflet').then(mod => mod.Marker),
  { ssr: false }
);
const Popup = dynamic(
  () => import('react-leaflet').then(mod => mod.Popup),
  { ssr: false }
);

interface MarkerData {
  lat: number;
  lng: number;
  label?: string;
  color?: string;
}

export function MapViewer({
  center,
  zoom = 14,
  markers = [],
  className = 'h-64',
}: {
  center: [number, number];
  zoom?: number;
  markers?: MarkerData[];
  className?: string;
}) {
  const allMarkers = useMemo(() => markers ?? [], [markers]);

  return (
    <div className={className}>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%', borderRadius: 'var(--radius)' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://upload.wikimedia.org/wikipedia/commons/0/03/Tiled_web_map_Stevage.png?utm_source=en.wikipedia.org&utm_campaign=index&utm_content=original"
        />
        {allMarkers.map((m: MarkerData, idx: number) => (
          <Marker key={idx} position={[m?.lat ?? 0, m?.lng ?? 0]}>
            {m?.label ? <Popup>{m.label}</Popup> : null}
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
