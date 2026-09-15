// LIVE PostgreSQL integration test for the AI-intake -> Work Order approval path.
//
// Unlike the static acceptance harnesses, this exercises the REAL approveIntake
// transaction against a REAL PostgreSQL database. It MUST be pointed at a
// disposable test database (never production) - the guard below refuses to run
// unless DATABASE_URL targets the dedicated disposable port.
//
// Cases:
//   A CONCURRENT APPROVAL   - two simultaneous approvals -> exactly ONE Job.
//   B MID-CREATION FAILURE  - deterministic failure after >=1 Task -> full
//                             rollback (0 Job, 0 Task), intake not stranded,
//                             retry succeeds.
//   C REVIEW RACE           - authoritative gate reads persisted state; a
//                             flagged/PENDING item cannot be tasked, and a
//                             concurrent flip never yields a partial WO.
//   D ANALYZING STATE       - approval of an ANALYZING intake is rejected.
//   E LOST RESPONSE / RETRY - a retried successful approval returns the SAME
//                             Job, never a second WO.
//
// Run: DATABASE_URL=postgresql://postgres@127.0.0.1:55432/fibertrack_test \
//        node_modules/.bin/tsx scripts/integration/approval-live-db.ts
import { prisma } from '@/lib/prisma';
import { approveIntake, AiApproveError } from '@/lib/ai-intake/approve';

const DB = process.env.DATABASE_URL || '';
if (!/:55432\//.test(DB)) {
  console.error('REFUSING TO RUN: DATABASE_URL must target the disposable test cluster on port 55432.');
  console.error('  got: ' + DB.replace(/\/\/[^@]*@/, '//<redacted>@'));
  process.exit(2);
}

const actor = { id: 'itest-actor', email: 'itest@example.com', role: 'ADMIN' };

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ': ' + detail : '')); }
}

let seq = 0;
function uniq(prefix: string): string { seq++; return `${prefix}-${Date.now()}-${seq}`; }

async function jobCountFor(intakeNumber: string): Promise<number> {
  return prisma.job.count({ where: { notes: { contains: intakeNumber } } });
}
async function taskCountFor(jobId: string): Promise<number> {
  return prisma.task.count({ where: { jobId } });
}

type Fixtures = { primeId: string; projectId: string; versionId: string; taskTypeId: string };

async function seedFixtures(): Promise<Fixtures> {
  const tt = await prisma.taskType.create({
    data: { name: uniq('ITEST TaskType'), unitOfMeasure: 'each', description: 'integration test' },
  });
  const prime = await prisma.primeContractor.create({
    data: { companyName: uniq('ITEST Prime') },
  });
  const book = await prisma.priceBook.create({
    data: { primeContractorId: prime.id, name: uniq('ITEST Book'), version: 1, status: 'ACTIVE' },
  });
  const version = await prisma.priceBookVersion.create({
    data: { priceBookId: book.id, version: 1, status: 'ACTIVE', label: 'v1' },
  });
  const project = await prisma.project.create({
    data: {
      primeContractorId: prime.id,
      projectCode: uniq('ITEST-PRJ'),
      projectName: 'Integration Test Project',
      defaultPriceBookId: book.id,
      defaultPriceBookVersionId: version.id,
    },
  });
  return { primeId: prime.id, projectId: project.id, versionId: version.id, taskTypeId: tt.id };
}

// Create a fresh intake with items. `items` describes each item's flag + resolution.
async function makeIntake(
  fx: Fixtures,
  status: 'READY' | 'NEEDS_REVIEW' | 'ANALYZING',
  items: Array<{ deviceId: string; requiresReview?: boolean; reviewResolution?: string }>,
) {
  const intakeNumber = uniq('INTK');
  const intake = await prisma.aiWorkIntake.create({
    data: {
      intakeNumber,
      status: status as any,
      primeContractorId: fx.primeId,
      projectId: fx.projectId,
      title: 'itest',
      createdById: actor.id,
      items: {
        create: items.map((it, i) => ({
          orderIndex: i,
          deviceId: it.deviceId,
          requiresReview: it.requiresReview ?? false,
          reviewResolution: (it.reviewResolution ?? 'PENDING') as any,
        })),
      },
    },
    include: { items: { orderBy: { orderIndex: 'asc' } } },
  });
  return intake;
}

function decisionsFor(items: { id: string }[], taskTypeId: string) {
  return items.map((it) => ({ itemId: it.id, taskTypeId, quantity: 1 }));
}

async function caseA(fx: Fixtures) {
  console.log('\nA CONCURRENT APPROVAL');
  const intake = await makeIntake(fx, 'READY', [
    { deviceId: 'SP0001' }, { deviceId: 'SP0002' },
  ]);
  const input = { jobName: 'Concurrent WO', itemDecisions: decisionsFor(intake.items, fx.taskTypeId) };
  const [r1, r2] = await Promise.allSettled([
    approveIntake(intake.id, input, actor),
    approveIntake(intake.id, input, actor),
  ]);
  const jobs = await jobCountFor(intake.intakeNumber);
  ok('exactly ONE Job created under concurrent approval', jobs === 1, `jobCount=${jobs}`);
  const after = await prisma.aiWorkIntake.findUnique({ where: { id: intake.id } });
  ok('intake finalized IMPORTED with a resultingJobId', after?.status === 'IMPORTED' && !!after?.resultingJobId,
    `status=${after?.status} job=${after?.resultingJobId}`);
  const tasks = after?.resultingJobId ? await taskCountFor(after.resultingJobId) : -1;
  ok('the single Job has exactly the expected 2 Tasks', tasks === 2, `taskCount=${tasks}`);
  const settled = [r1, r2];
  const fulfilled = settled.filter((r) => r.status === 'fulfilled').length;
  // At least one call must succeed; the loser either returns the same job
  // (alreadyImported) or throws a safe "already being approved" error - never a
  // second WO (already asserted by jobs === 1).
  ok('at least one approval succeeds; no second WO regardless of loser outcome', fulfilled >= 1 && jobs === 1,
    `fulfilled=${fulfilled}`);
}

async function caseB(fx: Fixtures) {
  console.log('\nB MID-CREATION FAILURE / ROLLBACK');
  const intake = await makeIntake(fx, 'READY', [
    { deviceId: 'RB0001' }, { deviceId: 'RB0002' },
  ]);
  // item[0] valid taskType (Task #1 would create), item[1] invalid FK -> the
  // Task create fails AFTER the first task, forcing a rollback of the whole tx.
  const badInput = {
    jobName: 'Rollback WO',
    itemDecisions: [
      { itemId: intake.items[0].id, taskTypeId: fx.taskTypeId, quantity: 1 },
      { itemId: intake.items[1].id, taskTypeId: 'nonexistent-tasktype-fk', quantity: 1 },
    ],
  };
  let threw = false;
  try { await approveIntake(intake.id, badInput, actor); } catch { threw = true; }
  ok('mid-creation failure propagates (approval throws)', threw);
  const jobs = await jobCountFor(intake.intakeNumber);
  ok('rollback leaves ZERO Job', jobs === 0, `jobCount=${jobs}`);
  const after = await prisma.aiWorkIntake.findUnique({ where: { id: intake.id } });
  ok('resultingJobId is null after rollback', !after?.resultingJobId, `job=${after?.resultingJobId}`);
  ok('intake NOT stranded in APPROVING (reverted to READY)', after?.status === 'READY', `status=${after?.status}`);
  // Any tasks that would have been created are gone (atomicity of Task #1).
  const strayTasks = await prisma.task.count({ where: { description: { in: ['RB0001', 'RB0002'] }, job: { notes: { contains: intake.intakeNumber } } } });
  ok('no partial Task survived the rollback', strayTasks === 0, `tasks=${strayTasks}`);
  // Retry with valid decisions now succeeds.
  const goodInput = { jobName: 'Rollback WO retry', itemDecisions: decisionsFor(intake.items, fx.taskTypeId) };
  const retry = await approveIntake(intake.id, goodInput, actor);
  const jobs2 = await jobCountFor(intake.intakeNumber);
  ok('retry after rollback succeeds with exactly ONE Job', jobs2 === 1 && !!(retry as any).job, `jobCount=${jobs2}`);
  const after2 = await prisma.aiWorkIntake.findUnique({ where: { id: intake.id } });
  const tasks2 = after2?.resultingJobId ? await taskCountFor(after2.resultingJobId) : -1;
  ok('retried Job has the expected 2 Tasks', tasks2 === 2, `taskCount=${tasks2}`);
}

async function caseC(fx: Fixtures) {
  console.log('\nC REVIEW RACE / AUTHORITATIVE GATE');
  // C(i): a flagged item still PENDING at approval time cannot be tasked.
  const pendingIntake = await makeIntake(fx, 'NEEDS_REVIEW', [
    { deviceId: 'RV0001', requiresReview: true, reviewResolution: 'PENDING' },
  ]);
  let rejected = false;
  try {
    await approveIntake(pendingIntake.id, { jobName: 'Review WO', itemDecisions: decisionsFor(pendingIntake.items, fx.taskTypeId) }, actor);
  } catch (e) { rejected = e instanceof AiApproveError; }
  const pj = await jobCountFor(pendingIntake.intakeNumber);
  ok('flagged+PENDING item is rejected by the authoritative gate', rejected, 'expected AiApproveError');
  ok('no Job created for a PENDING flagged item', pj === 0, `jobCount=${pj}`);

  // C(ii): concurrent approval vs a flip of the resolution to PENDING. Whatever
  // the interleaving, the outcome must be atomic and consistent - never a Job
  // with the wrong number of Tasks, and never a second WO.
  const raceIntake = await makeIntake(fx, 'NEEDS_REVIEW', [
    { deviceId: 'RV1001', requiresReview: true, reviewResolution: 'CONFIRMED' },
  ]);
  const input = { jobName: 'Race WO', itemDecisions: decisionsFor(raceIntake.items, fx.taskTypeId) };
  const flip = prisma.aiIntakeItem.update({
    where: { id: raceIntake.items[0].id },
    data: { reviewResolution: 'PENDING' as any },
  });
  const [appr] = await Promise.allSettled([approveIntake(raceIntake.id, input, actor), flip]);
  const jobs = await jobCountFor(raceIntake.intakeNumber);
  const after = await prisma.aiWorkIntake.findUnique({ where: { id: raceIntake.id } });
  if (appr.status === 'fulfilled' && (appr.value as any)?.job && jobs === 1) {
    // Approval won the claim first: the intake was frozen to APPROVING so the
    // flip could not corrupt it; the committed WO has exactly ONE task.
    const tasks = after?.resultingJobId ? await taskCountFor(after.resultingJobId) : -1;
    ok('race: committed WO is atomic (exactly 1 Job, 1 Task)', jobs === 1 && tasks === 1, `jobs=${jobs} tasks=${tasks}`);
  } else {
    // The flip landed first: the tx re-read saw PENDING and refused - no WO.
    ok('race: approval refused on flipped PENDING (no WO)', jobs === 0, `jobs=${jobs}`);
  }
  ok('race: never more than one WO', jobs <= 1, `jobs=${jobs}`);
}

async function caseD(fx: Fixtures) {
  console.log('\nD ANALYZING STATE REJECTED');
  const intake = await makeIntake(fx, 'ANALYZING', [{ deviceId: 'AN0001', reviewResolution: 'CONFIRMED' }]);
  let rejected = false;
  try {
    await approveIntake(intake.id, { jobName: 'Analyzing WO', itemDecisions: decisionsFor(intake.items, fx.taskTypeId) }, actor);
  } catch (e) { rejected = e instanceof AiApproveError; }
  const jobs = await jobCountFor(intake.intakeNumber);
  const after = await prisma.aiWorkIntake.findUnique({ where: { id: intake.id } });
  ok('approval of an ANALYZING intake is rejected', rejected);
  ok('ANALYZING intake: ZERO Job', jobs === 0, `jobCount=${jobs}`);
  ok('ANALYZING intake left untouched (still ANALYZING)', after?.status === 'ANALYZING', `status=${after?.status}`);
}

async function caseE(fx: Fixtures) {
  console.log('\nE LOST RESPONSE / RETRY IDEMPOTENCY');
  const intake = await makeIntake(fx, 'READY', [{ deviceId: 'ID0001' }]);
  const input = { jobName: 'Idempotent WO', itemDecisions: decisionsFor(intake.items, fx.taskTypeId) };
  const first = await approveIntake(intake.id, input, actor) as any;
  const jobs1 = await jobCountFor(intake.intakeNumber);
  ok('first approval creates exactly ONE Job', jobs1 === 1 && !!first.job, `jobCount=${jobs1}`);
  // Simulate a retried (lost-response) request.
  const second = await approveIntake(intake.id, input, actor) as any;
  const jobs2 = await jobCountFor(intake.intakeNumber);
  ok('retry returns the SAME Job (idempotent), no second WO', jobs2 === 1 && second.job?.id === first.job?.id,
    `jobCount=${jobs2} sameId=${second.job?.id === first.job?.id}`);
  ok('retry is flagged alreadyImported', second.alreadyImported === true, `alreadyImported=${second.alreadyImported}`);
}

async function main() {
  console.log('APPROVAL LIVE-DB INTEGRATION TEST');
  const fx = await seedFixtures();
  await caseA(fx);
  await caseB(fx);
  await caseC(fx);
  await caseD(fx);
  await caseE(fx);
  console.log(`\nAPPROVAL LIVE-DB INTEGRATION: ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error('FATAL', e);
  await prisma.$disconnect();
  process.exit(1);
});
