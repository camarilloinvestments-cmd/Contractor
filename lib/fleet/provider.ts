// Increment 8 — provider-agnostic fleet telematics abstraction.
//
//   FleetTelemetryProvider
//        |
//        +-- GeotabProvider       (official MyGeotab API)
//        +-- MockGeotabProvider   (official-compatible fixture for testing)
//        +-- FutureFleetProvider  (normalize into the same OS1 models)
//
// Provider data is normalized into the shapes below and then persisted into the
// OS1 fleet/location models, so the Live Map never depends on Geotab-specific
// tables.

export type FleetProviderConfig = {
  database: string | null;
  username: string | null;
  credential: string | null;
  serverUrl: string | null;
  sessionId?: string | null;
};

export type NormalizedVehicle = {
  providerDeviceId: string;
  name: string;
  vehicleNumber?: string | null;
  vin?: string | null;
  licensePlate?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
};

export type NormalizedStatus = {
  providerDeviceId: string;
  latitude: number;
  longitude: number;
  recordedAt: string; // ISO 8601
  speed?: number | null; // mph
  bearing?: number | null; // degrees
  driving?: boolean | null;
  communicating?: boolean | null;
  driverName?: string | null;
  providerRef?: string | null; // provider event/record id (for dedup)
};

export type FeedResult = {
  toVersion: string | null;
  data: NormalizedStatus[];
};

export type ConnectionResult = {
  ok: boolean;
  serverUrl?: string | null;
  sessionId?: string | null;
  message?: string;
};

export interface FleetTelemetryProvider {
  readonly name: string;
  // Verify credentials without persisting anything.
  testConnection(cfg: FleetProviderConfig): Promise<ConnectionResult>;
  // Authenticate and return a (cacheable) session token + resolved server.
  authenticate(cfg: FleetProviderConfig): Promise<ConnectionResult>;
  // Current fleet inventory.
  listVehicles(cfg: FleetProviderConfig): Promise<NormalizedVehicle[]>;
  // Continuous "current state" feed (position/speed/driving) with checkpoint.
  getStatusFeed(cfg: FleetProviderConfig, fromVersion: string | null): Promise<FeedResult>;
  // Historical breadcrumb feed with checkpoint.
  getLogFeed(cfg: FleetProviderConfig, fromVersion: string | null): Promise<FeedResult>;
}
