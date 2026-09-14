/*
 * Option A architecture acceptance harness.
 *
 * Verifies the first-class Project + immutable PriceBookVersion + pinned
 * Work Order architecture by running the REAL service code
 * (lib/projects.ts, lib/price-books.ts, lib/work-orders.ts) against an
 * in-memory fake Prisma client injected via globalThis BEFORE the libs are
 * imported. No live database is required.
 *
 * What this proves: the resolution / snapshot / pinning LOGIC in the real
 * service layer behaves correctly. It does NOT exercise the Postgres engine,
 * SQL constraints, or the migration (no DB server is available in this
 * environment) - those remain a live-DB verification item.
 *
 * Run:  node_modules/.bin/tsx scripts/architecture-acceptance.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;

// ---------------------------------------------------------------------------
// In-memory store + minimal Prisma-compatible query engine (only the query
// shapes actually used by the three service libs are implemented).
// ---------------------------------------------------------------------------
const db = {
  primeContractor: [] as Row[],
  project: [] as Row[],
  priceBook: [] as Row[],
  priceBookVersion: [] as Row[],
  priceLine: [] as Row[],
  job: [] as Row[],
  task: [] as Row[],
};

let _id = 0;
const nid = (p: string) => `${p}_${++_id}`;

function matchWhere(row: Row, where?: Row): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if ('not' in v) {
        if (row[k] === (v as any).not) return false;
        continue;
      }
      // No other object-valued filters are used by the libs under test.
      return false;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function orderRows(rows: Row[], orderBy?: Row): Row[] {
  if (!orderBy) return rows;
  const [key, dir] = Object.entries(orderBy)[0] as [string, 'asc' | 'desc'];
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === bv) return 0;
    const cmp = av > bv ? 1 : -1;
    return dir === 'desc' ? -cmp : cmp;
  });
}

function clone<T>(o: T): T {
  return o == null ? o : JSON.parse(JSON.stringify(o));
}

// Attach the specific relations the libs request via `include`.
function withInclude(model: string, row: Row | null, include?: Row): Row | null {
  if (!row || !include) return row ? clone(row) : row;
  const out = clone(row);
  if (model === 'priceBookVersion') {
    if (include.lines) out.lines = db.priceLine.filter((l) => l.priceBookVersionId === row.id).map(clone);
    if (include.priceBook) {
      const pb = db.priceBook.find((b) => b.id === row.priceBookId) || null;
      out.priceBook = pb ? clone(pb) : null;
    }
  }
  if (model === 'project') {
    if (include.defaultPriceBookVersion) {
      const v = db.priceBookVersion.find((x) => x.id === row.defaultPriceBookVersionId) || null;
      out.defaultPriceBookVersion = v
        ? withInclude('priceBookVersion', v, include.defaultPriceBookVersion.include)
        : null;
    }
    if (include.defaultPriceBook) {
      const b = db.priceBook.find((x) => x.id === row.defaultPriceBookId) || null;
      out.defaultPriceBook = b ? clone(b) : null;
    }
  }
  return out;
}

function makeModel(model: keyof typeof db) {
  const rows = () => db[model];
  return {
    findUnique: async ({ where, include, select }: any) => {
      const row = rows().find((r) => matchWhere(r, where)) || null;
      if (select) return row ? clone(row) : null; // select is a subset; superset is fine for our use
      return withInclude(model, row, include);
    },
    findFirst: async ({ where, orderBy, include }: any = {}) => {
      const found = orderRows(rows().filter((r) => matchWhere(r, where)), orderBy)[0] || null;
      return withInclude(model, found, include);
    },
    findMany: async ({ where, orderBy, include }: any = {}) => {
      const found = orderRows(rows().filter((r) => matchWhere(r, where)), orderBy);
      return found.map((r) => withInclude(model, r, include));
    },
    create: async ({ data, include }: any) => {
      const row: Row = { ...data };
      if (!row.id) row.id = nid(model);
      // nested line creates for priceBookVersion
      if (model === 'priceBookVersion' && data.lines && data.lines.create) {
        rows().push(row);
        for (const l of data.lines.create) {
          db.priceLine.push({ id: nid('priceLine'), priceBookVersionId: row.id, ...l });
        }
        delete row.lines;
        return withInclude(model, row, include);
      }
      rows().push(row);
      return withInclude(model, row, include);
    },
    update: async ({ where, data, include }: any) => {
      const row = rows().find((r) => matchWhere(r, where));
      if (!row) throw new Error(`${model}.update: row not found`);
      Object.assign(row, data);
      return withInclude(model, row, include);
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows().filter((x) => matchWhere(x, where))) {
        Object.assign(r, data);
        count++;
      }
      return { count };
    },
  };
}

const fakePrisma: any = {
  primeContractor: makeModel('primeContractor'),
  project: makeModel('project'),
  priceBook: makeModel('priceBook'),
  priceBookVersion: makeModel('priceBookVersion'),
  priceLine: makeModel('priceLine'),
  job: makeModel('job'),
  task: makeModel('task'),
};
fakePrisma.$transaction = async (fn: any) => fn(fakePrisma);

// Inject BEFORE importing the libs so lib/prisma.ts picks up the fake.
(globalThis as any).prisma = fakePrisma;

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const results: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    results.push(`  \u2713 ${name}`);
  } else {
    failed++;
    results.push(`  \u2717 ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}
async function expectThrow(name: string, fn: () => Promise<any>, substr?: string) {
  try {
    await fn();
    check(name, false, 'expected an error but none was thrown');
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    check(name, substr ? msg.includes(substr) : true, substr ? `got "${msg}"` : '');
  }
}

async function main() {
  const projects = await import('@/lib/projects');
  const books = await import('@/lib/price-books');
  const wo = await import('@/lib/work-orders');

  // --- Fixture: two independent primes -------------------------------------
  const primeA = { id: nid('prime'), companyName: 'Comcast' };
  const primeB = { id: nid('prime'), companyName: 'Charter' };
  db.primeContractor.push(primeA, primeB);

  // Prime A book with code A3 = $150.00, F1 = $90.00
  const bookA = { id: nid('book'), primeContractorId: primeA.id, name: 'Comcast Book', status: 'DRAFT', version: 0 };
  db.priceBook.push(bookA);
  const bookAv1 = await books.createPriceBookVersion(bookA.id, [
    { jobCode: 'A3', description: 'Aerial 3-strand', unit: 'FT', ratePerUnit: 15000 },
    { jobCode: 'F1', description: 'Fiber splice', unit: 'EA', ratePerUnit: 9000 },
  ], { label: 'v1' });
  await books.activatePriceBookVersion(bookAv1.id);

  // Prime B book ALSO has a code A3 but at a DIFFERENT rate = $220.00
  const bookB = { id: nid('book'), primeContractorId: primeB.id, name: 'Charter Book', status: 'DRAFT', version: 0 };
  db.priceBook.push(bookB);
  const bookBv1 = await books.createPriceBookVersion(bookB.id, [
    { jobCode: 'A3', description: 'Directional bore', unit: 'FT', ratePerUnit: 22000 },
  ], { label: 'v1' });
  await books.activatePriceBookVersion(bookBv1.id);

  // Projects: same code FL-ARCADIA under BOTH primes
  const projA = await projects.createProject({ primeContractorId: primeA.id, projectCode: 'FL-ARCADIA', projectName: 'Arcadia FL' });
  const projB = await projects.createProject({ primeContractorId: primeB.id, projectCode: 'FL-ARCADIA', projectName: 'Arcadia FL (Charter)' });
  await projects.setProjectDefaults(projA.id, { defaultPriceBookId: bookA.id });
  await projects.setProjectDefaults(projB.id, { defaultPriceBookId: bookB.id });

  // === Test 1: two primes' A3 lines coexist (no global code table) =========
  const a3InA = db.priceLine.find((l) => l.priceBookVersionId === bookAv1.id && l.jobCode === 'A3');
  const a3InB = db.priceLine.find((l) => l.priceBookVersionId === bookBv1.id && l.jobCode === 'A3');
  check('T1 both primes have their own A3 line', !!a3InA && !!a3InB);

  // === Test 2: no cross-prime collision (same code, different rate) ========
  check('T2 A3 means different rates per prime (15000 vs 22000)',
    a3InA?.ratePerUnit === 15000 && a3InB?.ratePerUnit === 22000,
    `A=${a3InA?.ratePerUnit} B=${a3InB?.ratePerUnit}`);

  // === Test 3: WO creation requires a real Project ========================
  await expectThrow('T3 resolveWorkOrderPin rejects unknown project',
    () => wo.resolveWorkOrderPin({ projectId: 'does-not-exist' }), 'Project not found');

  // === Test 4: Comcast -> FL-ARCADIA resolves its default version =========
  const pinA = await wo.resolveWorkOrderPin({ projectId: projA.id });
  check('T4 project default resolves to its prime book + v1',
    pinA.primeContractorId === primeA.id && pinA.priceBookId === bookA.id && pinA.priceBookVersionId === bookAv1.id,
    JSON.stringify(pinA));

  // Create a Work Order (job) PINNED to v1, as the jobs POST route would.
  const job1 = { id: nid('job'), jobNumber: 'WO-00001', jobName: 'Arcadia Build', primeContractorId: pinA.primeContractorId,
    projectId: pinA.projectId, priceBookId: pinA.priceBookId, priceBookVersionId: pinA.priceBookVersionId, status: 'DRAFT' };
  db.job.push(job1);

  // === Test 5: A3 on job1 resolves ONLY from the pinned version ===========
  const t1 = await wo.addBillingCodeToTask({ jobId: job1.id, taskTypeId: 'tt1', jobCode: 'A3', quantity: 10, workerPayoutRate: 8000 });
  check('T5 task A3 snapshot uses pinned v1 rate 15000', t1.primeRatePerUnitSnapshot === 15000, `got ${t1.primeRatePerUnitSnapshot}`);

  // Now upload + activate a NEWER version v2 with A3 at a different rate.
  const bookAv2 = await books.createPriceBookVersion(bookA.id, [
    { jobCode: 'A3', description: 'Aerial 3-strand (2026)', unit: 'FT', ratePerUnit: 18000 },
    { jobCode: 'F1', description: 'Fiber splice', unit: 'EA', ratePerUnit: 9500 },
  ], { label: 'v2' });
  await books.activatePriceBookVersion(bookAv2.id);

  // === Test 6: newer version does NOT alter the historical WO =============
  const t1After = db.task.find((t) => t.id === t1.id);
  check('T6a existing task snapshot unchanged after v2 activation', t1After?.primeRatePerUnitSnapshot === 15000);
  const t2 = await wo.addBillingCodeToTask({ jobId: job1.id, taskTypeId: 'tt1', jobCode: 'A3', quantity: 5, workerPayoutRate: 8000 });
  check('T6b new task on v1-pinned WO still resolves 15000 after v2 exists', t2.primeRatePerUnitSnapshot === 15000, `got ${t2.primeRatePerUnitSnapshot}`);

  // === Test 7: a NEW work order can pick the newer version ================
  const pinA2 = await wo.resolveWorkOrderPin({ projectId: projA.id, overrideVersionId: bookAv2.id });
  check('T7a override resolves to v2', pinA2.priceBookVersionId === bookAv2.id);
  const job2 = { id: nid('job'), jobNumber: 'WO-00002', jobName: 'Arcadia Phase 2', primeContractorId: pinA2.primeContractorId,
    projectId: pinA2.projectId, priceBookId: pinA2.priceBookId, priceBookVersionId: pinA2.priceBookVersionId, status: 'DRAFT' };
  db.job.push(job2);
  const t3 = await wo.addBillingCodeToTask({ jobId: job2.id, taskTypeId: 'tt1', jobCode: 'A3', quantity: 10, workerPayoutRate: 8000 });
  check('T7b new WO pinned to v2 snapshots 18000', t3.primeRatePerUnitSnapshot === 18000, `got ${t3.primeRatePerUnitSnapshot}`);

  // === Test 8: billing (prime) and payout are independent =================
  check('T8 payout not derived from prime rate',
    t3.billingRate === 18000 && t3.workerPayoutRate === 8000 && t3.billableAmount === 180000 && t3.costAmount === 80000 && t3.profitAmount === 100000,
    JSON.stringify({ b: t3.billingRate, p: t3.workerPayoutRate, ba: t3.billableAmount, ca: t3.costAmount, pa: t3.profitAmount }));

  // === Test 9: snapshots reproduce historical financials =================
  check('T9 snapshot recomputes historical amount (15000 * 10 = 150000)',
    t1.calculatedPrimeAmount === 150000 && (t1.primeRatePerUnitSnapshot ?? 0) * 10 === t1.calculatedPrimeAmount);

  // === Test 10: no code is globally meaningful ===========================
  // The same jobCode 'A3' exists in multiple versions/books with different rates;
  // it can only be resolved WITH a version context. A cross-store code lookup is
  // inherently ambiguous (>=3 distinct A3 lines now: bookA v1, bookB v1, bookA v2).
  const allA3 = db.priceLine.filter((l) => l.jobCode === 'A3');
  const distinctRates = new Set(allA3.map((l) => l.ratePerUnit));
  check('T10 code A3 is ambiguous without a version (multiple distinct rates)',
    allA3.length >= 3 && distinctRates.size >= 3, `count=${allA3.length} rates=${[...distinctRates].join(',')}`);
  // And a version-scoped lookup on the OTHER prime never returns prime A's rate.
  const a3FromB = await fakePrisma.priceLine.findFirst({ where: { priceBookVersionId: bookBv1.id, jobCode: 'A3' } });
  check('T10b version-scoped A3 lookup stays within its prime', a3FromB.ratePerUnit === 22000);

  // Bonus: cross-prime override is rejected -------------------------------
  await expectThrow('T3b override version from another prime is rejected',
    () => wo.resolveWorkOrderPin({ projectId: projA.id, overrideVersionId: bookBv1.id }),
    'does not belong');

  // --- report -----------------------------------------------------------
  console.log('\nOption A architecture acceptance');
  console.log('================================');
  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
