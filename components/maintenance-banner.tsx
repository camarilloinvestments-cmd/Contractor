// Server-rendered maintenance notice. Reads the authoritative maintenance flag
// (UpdateSettings.maintenanceMode) and, when ON, shows a clean fixed banner on
// every page. It never blocks navigation: admins keep full access to the Update
// Center to inspect status, recover, and disable maintenance. Mutating API
// writes are separately rejected with 503 by the request proxy.
import { isMaintenanceActive } from '@/lib/maintenance-state';

export async function MaintenanceBanner() {
  let active = false;
  try {
    active = await isMaintenanceActive();
  } catch {
    active = false;
  }
  if (!active) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[100] bg-amber-500 text-amber-950 shadow-md"
    >
      <div className="mx-auto max-w-5xl px-4 py-2 text-center text-sm font-medium">
        <span className="font-semibold">System Maintenance</span>
        {' — '}
        An update is currently being installed. Some actions are temporarily
        unavailable. Please try again shortly.
      </div>
    </div>
  );
}
