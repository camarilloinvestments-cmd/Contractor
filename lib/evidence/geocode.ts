// Server-side reverse geocode for field photo evidence (spec §3).
//
// Provider is configurable (nominatim default, or 'none' to disable).
// Failure never invalidates evidence — it returns null and the caller proceeds.
// The Nominatim provider is free, key-less, and does not expose any credential
// to the browser. Results are logged with timestamp + provider for audit.
//
// This module is server-only (makes server-to-server HTTP requests).

export interface GeocodeResult {
  address: string;
  provider: string;
  lookedUpAt: Date;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

// Simple in-memory cache: key = rounded coords (4 decimals ~11 m), value = address.
// Prevents hammering Nominatim on rapid successive captures at the same site.
const cache = new Map<string, { address: string; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE = 500;

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

async function nominatimReverse(lat: number, lon: number): Promise<string | null> {
  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.address;

  try {
    const url = `${NOMINATIM_URL}?lat=${lat}&lon=${lon}&format=json&addressdetails=0&zoom=18`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OS1-FiberTrack-Evidence/1.0 (server-side reverse geocode)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data?.display_name;
    if (typeof addr === 'string' && addr.length > 0) {
      if (cache.size >= MAX_CACHE) {
        // Evict oldest
        const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (oldest) cache.delete(oldest[0]);
      }
      cache.set(key, { address: addr, ts: Date.now() });
      return addr;
    }
  } catch {
    // Network/timeout — return null, do not break evidence.
  }
  return null;
}

/**
 * Reverse-geocode a coordinate pair using the configured provider.
 * Returns null on failure (provider disabled, network error, etc.).
 * Never throws — callers proceed with coordinates-only evidence.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  provider: string
): Promise<GeocodeResult | null> {
  if (!provider || provider === 'none') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  if (provider === 'nominatim') {
    const address = await nominatimReverse(lat, lon);
    if (!address) return null;
    return { address, provider: 'nominatim', lookedUpAt: new Date() };
  }

  // Unknown provider — treat as 'none'.
  return null;
}
