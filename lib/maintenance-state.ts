// Cached reader for the authoritative maintenance flag
// (UpdateSettings.maintenanceMode). Imported by the request proxy and the
// server-rendered maintenance banner. Runs on the Node.js runtime (the Next 16
// proxy always does), so it can use the Prisma client directly.
//
// A tiny in-process TTL cache keeps the per-request cost near zero during normal
// operation (maintenance OFF) while still reflecting a toggle within a few
// seconds. Never logs or returns secret values — only the boolean flag.
import { prisma } from '@/lib/prisma';
import { UPDATE_SETTINGS_ID } from '@/lib/updates';

const TTL_MS = 3000;
let cache: { value: boolean; at: number } | null = null;

export function _resetMaintenanceCache() {
  cache = null;
}

export async function isMaintenanceActive(): Promise<boolean> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  try {
    const s = await prisma.updateSettings.findUnique({
      where: { id: UPDATE_SETTINGS_ID },
      select: { maintenanceMode: true },
    });
    const value = !!s?.maintenanceMode;
    cache = { value, at: now };
    return value;
  } catch {
    // Fail OPEN for the gate: if the settings row can't be read (e.g. transient
    // DB blip), do not wedge the whole app. A real maintenance window is driven
    // by the updater which enables the flag against a reachable DB, and mutating
    // requests would fail on their own if the DB were truly down. Never surface
    // the error details (may reference connection info).
    return cache?.value ?? false;
  }
}
