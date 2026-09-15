// Q00 ACCEPTANCE FIXTURE — deterministic, NO live OpenAI call.
//
// Feeds a canned model response (the permanent Q00 fixture) through the strict
// zod contract and the deterministic OS1 business-rule layer, then asserts the
// hard policy guarantees:
//   * device ids are preserved EXACTLY (NP0001.E1 is never rewritten to D1)
//   * a section not confirmed by the supplied drawing => mandatory review
//   * low confidence => review
//   * undefined priority terms ("66 work") => warning + dependent review
//   * re-entry devices carry a re-entry reason and are flagged
//   * priority text is preserved verbatim and structured
//
// Run: node_modules/.bin/tsx scripts/acceptance/q00-fixture-acceptance.ts
import assert from 'assert';
import {
  AiIntakeResponseSchema,
  AiIntakeResponse,
  sectionFromDeviceId,
} from '../../lib/ai-intake/schema';
import { applyBusinessRules } from '../../lib/ai-intake/business';

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass++;
      console.log('  PASS  ' + name);
    })
    .catch((e: any) => {
      fail++;
      console.log('  FAIL  ' + name + ': ' + (e?.message || e));
    });
}

// ---- helpers ---------------------------------------------------------------
function item(deviceId: string, over: Partial<any> = {}) {
  return {
    device_id: deviceId,
    proposed_type: over.proposed_type ?? 'splice',
    route_section: over.route_section ?? sectionFromDeviceId(deviceId),
    instructions: over.instructions ?? null,
    reentry_required: over.reentry_required ?? false,
    reentry_reason: over.reentry_reason ?? null,
    partial_work_allowed: over.partial_work_allowed ?? false,
    blocked_dependency: over.blocked_dependency ?? null,
    dependencies: over.dependencies ?? [],
    confidence: over.confidence ?? 0.95,
    requires_review: over.requires_review ?? false,
    review_reason: over.review_reason ?? null,
    source_reference: over.source_reference ?? 'prime email',
    proposed_billing_code_suggestion: over.proposed_billing_code_suggestion ?? null,
  };
}

// The permanent Q00 fixture (all 16 devices from the acceptance spec).
function q00Fixture(): AiIntakeResponse {
  return {
    schema_version: '1',
    project_reference: 'Q00 Prime Instruction',
    priority_raw_text: 'Please prioritize the 66 work, then enclosures, then nap.',
    priority_order: ['66 work', 'enclosures', 'nap'],
    confirmed_sections: ['A1', 'B1', 'C1', 'D1'],
    items: [
      // SP tails
      item('SP0653', {
        instructions: 'North tail requires later re-entry after 66 work.',
        reentry_required: true,
        reentry_reason: 'North tail cannot be completed until dependency clears.',
      }),
      item('SP0554', { instructions: 'North and south.' }),
      item('SP0652'),
      // C1 section
      item('NP0005.C1'),
      item('NP0004.C1'),
      item('NP0003.C1'),
      item('NP0002.C1'),
      // A1 section
      item('NP0035.A1'),
      item('NP0034.A1'),
      item('NP0033.A1'),
      item('NP0032.A1'),
      // E1 — NOT a confirmed section; must be flagged, never rewritten to D1
      item('NP0001.E1', { confidence: 0.62 }),
      // B1 section
      item('NP0003.B1'),
      item('NP0004.B1'),
      item('NP0005.B1'),
    ],
    warnings: [],
  };
}

async function main() {
  const fixture = q00Fixture();

  await check('Q00 fixture passes the strict zod contract', () => {
    const parsed = AiIntakeResponseSchema.safeParse(fixture);
    assert.ok(parsed.success, 'fixture must satisfy AiIntakeResponseSchema');
  });

  await check('sectionFromDeviceId parses the trailing section suffix', () => {
    assert.strictEqual(sectionFromDeviceId('NP0001.E1'), 'E1');
    assert.strictEqual(sectionFromDeviceId('NP0005.C1'), 'C1');
    assert.strictEqual(sectionFromDeviceId('SP0653'), null);
  });

  // approvedTerms deliberately WITHOUT "66 work" — its meaning is not approved.
  const ctx = { approvedTerms: new Set<string>(['enclosures', 'nap']) };
  const result = applyBusinessRules(fixture, ctx);

  await check('device ids are preserved EXACTLY (no E1 -> D1 mutation)', () => {
    const got = result.items.map((i) => i.device_id);
    const want = fixture.items.map((i) => i.device_id);
    assert.deepStrictEqual(got, want, 'every device id must be preserved verbatim');
    assert.ok(got.includes('NP0001.E1'), 'NP0001.E1 must still be present');
    assert.ok(!got.includes('NP0001.D1'), 'NP0001.E1 must NEVER become NP0001.D1');
  });

  await check('NP0001.E1 (section not confirmed by drawing) is flagged NEEDS REVIEW', () => {
    const e1 = result.items.find((i) => i.device_id === 'NP0001.E1')!;
    assert.ok(e1, 'E1 item present');
    assert.strictEqual(e1.requires_review, true, 'E1 must require review');
    assert.ok(
      /not confirmed/i.test(e1.review_reason || ''),
      'E1 review reason must cite the unconfirmed section',
    );
    assert.strictEqual(e1._section_derived, 'E1');
  });

  await check('confirmed-section items are NOT flagged for a section contradiction', () => {
    for (const dev of ['NP0005.C1', 'NP0035.A1', 'NP0003.B1']) {
      const it = result.items.find((i) => i.device_id === dev)!;
      const reason = it.review_reason || '';
      assert.ok(
        !/not confirmed/i.test(reason),
        `${dev} is in a confirmed section and must not be flagged for section contradiction`,
      );
    }
  });

  await check('low confidence (<0.75) forces review', () => {
    const e1 = result.items.find((i) => i.device_id === 'NP0001.E1')!;
    assert.ok(/low confidence/i.test(e1.review_reason || ''), 'low confidence must be cited');
    assert.strictEqual(e1._tier, 'LOW');
  });

  await check('undefined priority term "66 work" produces a warning', () => {
    const joined = result.warnings.join(' | ').toLowerCase();
    assert.ok(joined.includes('66 work'), 'warnings must call out the undefined priority term');
    assert.ok(
      /approved prime\/project definition/i.test(result.warnings.join(' | ')),
      'warning must explain the missing approved definition',
    );
  });

  await check('an item referencing the undefined priority term is flagged for review', () => {
    const sp0653 = result.items.find((i) => i.device_id === 'SP0653')!;
    // Its instructions mention "66 work", which has no approved meaning.
    assert.strictEqual(sp0653.requires_review, true);
    assert.ok(
      /undefined priority term/i.test(sp0653.review_reason || ''),
      'review reason must cite the undefined priority term',
    );
  });

  await check('priority text is preserved verbatim AND structured', () => {
    assert.strictEqual(
      result.response.priority_raw_text,
      'Please prioritize the 66 work, then enclosures, then nap.',
    );
    assert.deepStrictEqual(result.response.priority_order, ['66 work', 'enclosures', 'nap']);
  });

  await check('re-entry device carries a reason and is preserved', () => {
    const sp0653 = result.items.find((i) => i.device_id === 'SP0653')!;
    assert.strictEqual(sp0653.reentry_required, true);
    assert.ok((sp0653.reentry_reason || '').length > 0, 'a re-entry reason must be present');
  });

  await check('confidence summary counts are consistent', () => {
    const s = result.confidenceSummary;
    const total = s.high + s.medium + s.low;
    assert.strictEqual(total, result.items.length, 'every item lands in exactly one tier');
    assert.ok(s.low >= 1, 'the E1 item is LOW tier');
    assert.ok(s.review >= 2, 'at least E1 + the 66-work item require review');
  });

  await check('device ids are NEVER treated as billing codes by the rule layer', () => {
    // The normalized items expose only a SUGGESTION field; no billing code is set.
    for (const it of result.items) {
      // proposed_billing_code_suggestion is advisory only and defaults to null here.
      assert.ok(
        !('billing_code' in (it as any)),
        'normalized items must not carry an authoritative billing_code',
      );
    }
  });

  console.log(`\nQ00 FIXTURE: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
