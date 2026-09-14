// Increment 8 — Geotab telematics provider.
//
// Uses the official MyGeotab JSON-RPC API (https://<server>/apiv1) with the
// documented methods Authenticate, Get<Device>, and GetFeed<DeviceStatusInfo|
// LogRecord>. Server-side only. The Geotab web UI is never scraped.
//
// When the configured database is "MOCK", an official-compatible fixture
// provider is used instead so the connector can be demonstrated end-to-end
// without live credentials. The fixture returns data in the SAME normalized
// shape and honors the feed checkpoint (fromVersion/toVersion) so resume works
// and historical records are never duplicated.
import type {
  FleetTelemetryProvider,
  FleetProviderConfig,
  NormalizedVehicle,
  NormalizedStatus,
  FeedResult,
  ConnectionResult,
} from './provider';

const KMH_TO_MPH = 0.621371;
const DEFAULT_FEDERATION = 'my.geotab.com';
const RPC_TIMEOUT_MS = 20000;

function kmhToMph(v: number | null | undefined): number | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return Math.round(v * KMH_TO_MPH * 10) / 10;
}

async function rpc(server: string, method: string, params: Record<string, unknown>): Promise<any> {
  const url = `https://${server.replace(/^https?:\/\//, '').replace(/\/.*/, '')}/apiv1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (json?.error) {
      const msg = json.error?.message || json.error?.errors?.[0]?.message || 'Geotab API error';
      throw new Error(msg);
    }
    return json?.result;
  } finally {
    clearTimeout(timer);
  }
}

export class GeotabProvider implements FleetTelemetryProvider {
  readonly name = 'GEOTAB';

  private credentials(cfg: FleetProviderConfig) {
    return { database: cfg.database, userName: cfg.username, sessionId: cfg.sessionId ?? undefined };
  }

  async authenticate(cfg: FleetProviderConfig): Promise<ConnectionResult> {
    if (!cfg.database || !cfg.username || !cfg.credential) {
      return { ok: false, message: 'Database, username and credential are required.' };
    }
    const startServer = cfg.serverUrl || DEFAULT_FEDERATION;
    try {
      let result = await rpc(startServer, 'Authenticate', {
        database: cfg.database,
        userName: cfg.username,
        password: cfg.credential,
      });
      // Federation may redirect to the account's real server.
      let server = startServer;
      if (result?.path && result.path !== 'ThisServer') {
        server = result.path;
        result = await rpc(server, 'Authenticate', {
          database: cfg.database,
          userName: cfg.username,
          password: cfg.credential,
        });
      }
      const sessionId = result?.credentials?.sessionId ?? null;
      if (!sessionId) return { ok: false, message: 'Authentication did not return a session.' };
      return { ok: true, serverUrl: server, sessionId };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async testConnection(cfg: FleetProviderConfig): Promise<ConnectionResult> {
    return this.authenticate(cfg);
  }

  async listVehicles(cfg: FleetProviderConfig): Promise<NormalizedVehicle[]> {
    const server = cfg.serverUrl || DEFAULT_FEDERATION;
    const devices = await rpc(server, 'Get', {
      typeName: 'Device',
      credentials: this.credentials(cfg),
      resultsLimit: 5000,
    });
    if (!Array.isArray(devices)) return [];
    return devices.map((d: any) => ({
      providerDeviceId: String(d.id),
      name: d.name || String(d.id),
      vehicleNumber: d.name || null,
      vin: d.vehicleIdentificationNumber || null,
      licensePlate: d.licensePlate || null,
      make: d.make || null,
      model: d.model || null,
      year: typeof d.year === 'number' ? d.year : null,
    }));
  }

  private normalizeStatus(rows: any[]): NormalizedStatus[] {
    return (rows || [])
      .filter((r) => r?.device?.id && typeof r.latitude === 'number' && typeof r.longitude === 'number')
      .map((r: any) => {
        const driverId = r.driver && typeof r.driver === 'object' ? r.driver.id : r.driver;
        const driverName = driverId && driverId !== 'UnknownDriverId' ? String(driverId) : null;
        return {
          providerDeviceId: String(r.device.id),
          latitude: r.latitude,
          longitude: r.longitude,
          recordedAt: r.dateTime || new Date().toISOString(),
          speed: kmhToMph(r.speed),
          bearing: typeof r.bearing === 'number' ? r.bearing : null,
          driving: typeof r.isDriving === 'boolean' ? r.isDriving : null,
          communicating: typeof r.isDeviceCommunicating === 'boolean' ? r.isDeviceCommunicating : null,
          driverName,
          providerRef: r.id ? String(r.id) : null,
        } as NormalizedStatus;
      });
  }

  async getStatusFeed(cfg: FleetProviderConfig, fromVersion: string | null): Promise<FeedResult> {
    const server = cfg.serverUrl || DEFAULT_FEDERATION;
    const result = await rpc(server, 'GetFeed', {
      typeName: 'DeviceStatusInfo',
      credentials: this.credentials(cfg),
      fromVersion: fromVersion ?? undefined,
    });
    return { toVersion: result?.toVersion ?? null, data: this.normalizeStatus(result?.data || []) };
  }

  async getLogFeed(cfg: FleetProviderConfig, fromVersion: string | null): Promise<FeedResult> {
    const server = cfg.serverUrl || DEFAULT_FEDERATION;
    const result = await rpc(server, 'GetFeed', {
      typeName: 'LogRecord',
      credentials: this.credentials(cfg),
      fromVersion: fromVersion ?? undefined,
    });
    return { toVersion: result?.toVersion ?? null, data: this.normalizeStatus(result?.data || []) };
  }
}

// --------------------------------------------------------------------------
// Official-compatible fixture provider (database === "MOCK").
// Two vehicles move along deterministic routes near a demo job site so the Live
// Map, geofence events, and history/playback can be demonstrated offline.
// --------------------------------------------------------------------------
export const MOCK_DEVICES: NormalizedVehicle[] = [
  {
    providerDeviceId: 'GT-DEV-TRUCK121',
    name: 'Truck 121',
    vehicleNumber: '121',
    vin: '1FTFW1EF1EKE00121',
    licensePlate: 'OS1-121',
    make: 'Ford',
    model: 'F-250',
    year: 2021,
  },
  {
    providerDeviceId: 'GT-DEV-VAN207',
    name: 'Splice Van 207',
    vehicleNumber: '207',
    vin: '1GCWGAFP7N1200207',
    licensePlate: 'OS1-207',
    make: 'Chevrolet',
    model: 'Express',
    year: 2022,
  },
];

// Demo job site (also used by the seed) — downtown Fresno, CA.
export const MOCK_JOB_SITE = { lat: 36.7378, lng: -119.7871 };

// A short route that ends inside the job-site geofence, per device.
function routeFor(deviceId: string, step: number): { lat: number; lng: number; speedKmh: number; bearing: number } {
  const base = deviceId.includes('121')
    ? { lat: 36.7601, lng: -119.812 } // starts at the yard, NW of the site
    : { lat: 36.7189, lng: -119.7620 }; // starts SE of the site
  const target = MOCK_JOB_SITE;
  const steps = 8;
  const t = Math.min(1, step / steps);
  const lat = base.lat + (target.lat - base.lat) * t;
  const lng = base.lng + (target.lng - base.lng) * t;
  const speedKmh = t >= 1 ? 0 : 45 + (deviceId.includes('121') ? 0 : 5);
  const bearing = deviceId.includes('121') ? 135 : 315;
  return { lat, lng, speedKmh, bearing };
}

export class MockGeotabProvider implements FleetTelemetryProvider {
  readonly name = 'GEOTAB';

  async authenticate(): Promise<ConnectionResult> {
    return { ok: true, serverUrl: 'mock.geotab.local', sessionId: 'MOCK-SESSION' };
  }
  async testConnection(): Promise<ConnectionResult> {
    return { ok: true, serverUrl: 'mock.geotab.local', sessionId: 'MOCK-SESSION', message: 'Mock Geotab fixture reachable.' };
  }
  async listVehicles(): Promise<NormalizedVehicle[]> {
    return MOCK_DEVICES;
  }

  // fromVersion is an integer cursor "stepN". Each call advances one step along
  // the route and returns one status per device. Re-calling with the same
  // fromVersion yields the same records (idempotent), and providerRef is unique
  // per (device, step) so persisted history is never duplicated on resume.
  private feed(fromVersion: string | null): FeedResult {
    const prev = fromVersion ? parseInt(fromVersion, 10) || 0 : 0;
    const step = Math.min(prev + 1, 8);
    const now = new Date().toISOString();
    const data: NormalizedStatus[] = MOCK_DEVICES.map((d) => {
      const r = routeFor(d.providerDeviceId, step);
      return {
        providerDeviceId: d.providerDeviceId,
        latitude: Math.round(r.lat * 1e6) / 1e6,
        longitude: Math.round(r.lng * 1e6) / 1e6,
        recordedAt: now,
        speed: kmhToMph(r.speedKmh),
        bearing: r.bearing,
        driving: r.speedKmh > 0,
        communicating: true,
        driverName: d.providerDeviceId.includes('121') ? 'Jose Camarillo' : 'Field Driver',
        providerRef: `${d.providerDeviceId}-step${step}`,
      };
    });
    return { toVersion: String(step), data };
  }

  async getStatusFeed(_cfg: FleetProviderConfig, fromVersion: string | null): Promise<FeedResult> {
    return this.feed(fromVersion);
  }
  async getLogFeed(_cfg: FleetProviderConfig, fromVersion: string | null): Promise<FeedResult> {
    return this.feed(fromVersion);
  }
}
