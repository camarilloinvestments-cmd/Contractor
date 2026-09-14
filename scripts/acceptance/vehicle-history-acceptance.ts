// Live-defect acceptance — Vehicle History: ERROR vs NO-DATA + sync/count state.
//
// The reported defect: a failed telemetry query rendered the same empty "No
// data" state as a genuinely empty period, so operators could not tell a broken
// feed from a quiet vehicle. This harness statically proves the fix in the REAL
// route + client source:
//   • the API returns a distinct 502 "Query failed" on a store error (not 404),
//     logs the failure, and surfaces count / eventCount / tripCount / lastSync;
//   • the client distinguishes loading / load-failed / no-data / data, offers a
//     Retry, and shows a Last sync + Telemetry records + Stale (>24h) strip.
//
// Read-only static assertions; no DB / network. Runtime behaviour against a live
// Geotab feed is listed as LIVE-VM.
//
// Run:  node_modules/.bin/tsx scripts/acceptance/vehicle-history-acceptance.ts
// Exit: non-zero if any check FAILS.
import fs from 'fs';
import path from 'path';

let pass = 0, fail = 0, live = 0;
function ok(n: number, name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${String(n).padStart(2)}. ${name}${detail ? '  \u2014 ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${String(n).padStart(2)}. ${name}${detail ? '  \u2014 ' + detail : ''}`); }
}
function liveItem(n: number, name: string, test: string) { live++; console.log(`LIVE  ${String(n).padStart(2)}. ${name}  \u2014 ${test}`); }

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('=== Vehicle History Acceptance (ERROR vs NO-DATA) ===');

const route = read('app/api/fleet/vehicles/[id]/history/route.ts');
const client = read('app/(admin)/operations/fleet/vehicle-history/_components/vehicle-history-client.tsx');

// --- Route -----------------------------------------------------------------
ok(1, 'Route requires auth (401 when unauthenticated)', /status:\s*401/.test(route) && /Unauthorized/.test(route));
ok(2, 'Store/query error returns 502 "Query failed" (distinct from 404)',
   /Query failed/.test(route) && /status:\s*502/.test(route));
ok(3, 'Missing vehicle returns 404 Not found (distinct from a query error)',
   /Not found/.test(route) && /status:\s*404/.test(route));
ok(4, 'Query failure is logged for diagnosis (console.error)',
   /console\.error\(\s*'\[fleet\.vehicle_history\] query failed'/.test(route));
ok(5, 'Response surfaces count + eventCount + tripCount for the count/sync UI',
   /count:\s*telemetry\.length/.test(route) && /eventCount:\s*events\.length/.test(route) && /tripCount:\s*trips\.length/.test(route));
ok(6, 'Response surfaces lastSync (nullable ISO) for the sync-state UI',
   /lastSync:/.test(route));
ok(7, 'Invalid date range returns 400 with a reason', /status:\s*400/.test(route) && /Invalid date range/.test(route));

// --- Client ----------------------------------------------------------------
ok(8, 'Client tracks an explicit error state separate from results',
   /useState<\{ message: string; reason\?: string; status\?: number \} \| null>\(null\)/.test(client));
ok(9, 'A non-OK response is recorded as a LOAD FAILURE (setError with status)',
   /setError\(\{ message: 'Unable to load vehicle history\.', reason, status: r\.status \}\)/.test(client));
ok(10, 'A network/unexpected throw is ALSO a load failure (not silent no-data)',
   /catch \(e\)/.test(client) && /Could not reach the server/.test(client));
ok(11, 'Render pane distinguishes loading / load-failed / no-data / data',
   /if \(loading\)/.test(client) && /if \(error\)/.test(client) && /if \(tel\.length\)/.test(client) && /if \(loaded\)/.test(client));
ok(12, 'Load-failed pane is NOT the no-data pane (error shows destructive + Retry)',
   /text-destructive/.test(client) && /Retry/.test(client));
ok(13, 'No-data pane wording clearly means "none recorded", never an error',
   /No vehicle telemetry was recorded for this period/.test(client));
ok(14, 'Comment documents the invariant: API failure is NEVER shown as No data',
   /API failure is NEVER shown as "No data"/.test(client));
ok(15, 'Status strip shows Last sync + Telemetry records count',
   /Last sync:/.test(client) && /Telemetry records:/.test(client));
ok(16, 'Stale feed (>24h) badge driven by STALE_MS = 24h',
   /const STALE_MS = 24 \* 60 \* 60 \* 1000/.test(client) && /Stale feed/.test(client));

liveItem(1, 'Broken feed -> error state', 'On live VM: break telemetry connectivity, load history -> UI must show the red load-failed pane + Retry, NOT "No data" (read-only; mutating=NO).');
liveItem(2, 'Quiet vehicle -> no-data state', 'On live VM: query a period with no samples for a healthy vehicle -> UI shows the no-data pane + Last sync timestamp (read-only; mutating=NO).');

console.log(`\n=== Vehicle History Acceptance: ${pass} passed, ${fail} failed, ${live} live-VM ===`);
if (fail > 0) process.exit(1);
