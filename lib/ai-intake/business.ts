// Deterministic business-rule layer applied AFTER the model returns and AFTER
// zod validation. This is where OS1 policy is enforced independently of the
// model's own judgement — the AI can never override these rules.
//
// Enforces: device ids preserved exactly; section-not-in-drawing => review; low
// confidence => review; undefined priority terms => review; and produces a
// normalized per-item review decision + a confidence summary.
import {
  AiIntakeResponse,
  AiIntakeItem,
  CONFIDENCE_REVIEW,
  confidenceTier,
  sectionFromDeviceId,
} from './schema';

export type NormalizedItem = AiIntakeItem & {
  _section_derived: string | null;
  _tier: 'HIGH' | 'MEDIUM' | 'LOW';
};

export type BusinessResult = {
  response: AiIntakeResponse; // possibly enriched (extra warnings, review flags)
  items: NormalizedItem[];
  warnings: string[];
  confidenceSummary: { high: number; medium: number; low: number; review: number };
};

export type BusinessContext = {
  // Lower-cased approved priority/terminology terms for this prime/project.
  approvedTerms: Set<string>;
};

function addReview(item: AiIntakeItem, reason: string): void {
  item.requires_review = true;
  item.review_reason = item.review_reason ? `${item.review_reason}; ${reason}` : reason;
}

export function applyBusinessRules(input: AiIntakeResponse, ctx: BusinessContext): BusinessResult {
  const warnings: string[] = [...(input.warnings ?? [])];
  const confirmed = new Set((input.confirmed_sections ?? []).map((s) => s.trim().toUpperCase()));

  // Which priority terms are referenced but have no approved definition.
  const undefinedPriorityTerms = (input.priority_order ?? []).filter(
    (t) => !ctx.approvedTerms.has(t.trim().toLowerCase()),
  );
  if (undefinedPriorityTerms.length) {
    warnings.push(
      `Priority term(s) without an approved Prime/Project definition: ${undefinedPriorityTerms.join(', ')}. Dependent decisions require operator review.`,
    );
  }

  const items: NormalizedItem[] = (input.items ?? []).map((raw) => {
    // Never mutate the device id — it is preserved exactly as extracted.
    const item: AiIntakeItem = { ...raw };
    const derived = sectionFromDeviceId(item.device_id);

    // Section-not-in-drawing contradiction => mandatory review; never reassign.
    if (confirmed.size > 0 && derived && !confirmed.has(derived)) {
      addReview(
        item,
        `Section ${derived} for ${item.device_id} is NOT confirmed in the supplied drawing (confirmed: ${[...confirmed].join(', ') || 'none'}). Operator must confirm; the section must not be silently reassigned.`,
      );
      warnings.push(`${item.device_id}: section ${derived} not confirmed in supplied drawing.`);
    }

    // Low confidence => review.
    if (item.confidence < CONFIDENCE_REVIEW) {
      addReview(item, `Low confidence (${item.confidence.toFixed(2)}).`);
    }

    // Priority-term dependency => review when its meaning is not approved.
    if (undefinedPriorityTerms.length && item.instructions) {
      const instr = item.instructions.toLowerCase();
      for (const term of undefinedPriorityTerms) {
        if (instr.includes(term.trim().toLowerCase())) {
          addReview(item, `References undefined priority term "${term}".`);
          break;
        }
      }
    }

    // Re-entry must never be presented as a completed device.
    if (item.reentry_required && !item.reentry_reason) {
      item.reentry_reason = 'Re-entry required (reason not specified by source).';
    }

    return { ...item, _section_derived: derived, _tier: confidenceTier(item.confidence) };
  });

  const summary = { high: 0, medium: 0, low: 0, review: 0 };
  for (const it of items) {
    if (it._tier === 'HIGH') summary.high++;
    else if (it._tier === 'MEDIUM') summary.medium++;
    else summary.low++;
    if (it.requires_review) summary.review++;
  }

  const response: AiIntakeResponse = { ...input, items, warnings };
  return { response, items, warnings, confidenceSummary: summary };
}
