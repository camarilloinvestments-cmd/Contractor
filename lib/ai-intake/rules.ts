// Prime/Project-scoped AI terminology + convention rules.
//
// Rules are NEVER universal across all primes. Every rule is scoped to a prime
// (and optionally a project). They are injected into the model as APPROVED
// context, and their ABSENCE drives requires_review for terms the request
// depends on (e.g. "66 work" with no approved definition).
import { prisma } from '@/lib/prisma';

export type ScopedAiRule = {
  id: string;
  ruleType: string;
  term: string;
  definition: string;
  projectId: string | null;
};

// Return active rules that apply to this prime, plus (optionally) the specific
// project. Prime-wide rules (projectId null) always apply; project rules apply
// only for the matching project.
export async function getScopedRules(
  primeContractorId: string,
  projectId?: string | null,
): Promise<ScopedAiRule[]> {
  const rows = await prisma.primeProjectAiRule.findMany({
    where: {
      primeContractorId,
      active: true,
      OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])],
    },
    orderBy: [{ ruleType: 'asc' }, { term: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    ruleType: r.ruleType,
    term: r.term,
    definition: r.definition,
    projectId: r.projectId,
  }));
}

// Compact, model-facing rendering of the approved rules. Returns '' when there
// are none so the prompt can state that no scoped terminology is defined.
export function renderRulesForPrompt(rules: ScopedAiRule[]): string {
  if (!rules.length) return '';
  return rules
    .map((r) => `- [${r.ruleType}] "${r.term}": ${r.definition}${r.projectId ? '' : ' (prime-wide)'}`)
    .join('\n');
}

// Lower-cased set of approved terms, used by the deterministic business layer to
// decide whether a referenced priority term has an approved definition.
export function approvedTermSet(rules: ScopedAiRule[]): Set<string> {
  return new Set(rules.map((r) => r.term.trim().toLowerCase()));
}
