// Strict, versioned, validated structured-output contract for AI Work Intake.
//
// OpenAI returns ONLY this shape (enforced server-side with a strict JSON schema
// AND re-validated with zod on receipt). The AI produces a DRAFT for operator
// review; it never creates operational or financial records. device_id values
// are work/device identifiers and are preserved EXACTLY — they are never treated
// as billing/SOW codes here.
import { z } from 'zod';

export const AI_INTAKE_SCHEMA_VERSION = '1';

// ---- zod validation (defense-in-depth over the model's strict schema) -------
const nullableStr = z.string().nullable();

export const AiIntakeItemSchema = z.object({
  device_id: z.string().min(1),
  proposed_type: nullableStr,
  route_section: nullableStr,
  instructions: nullableStr,
  reentry_required: z.boolean(),
  reentry_reason: nullableStr,
  partial_work_allowed: z.boolean(),
  blocked_dependency: nullableStr,
  dependencies: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  requires_review: z.boolean(),
  review_reason: nullableStr,
  source_reference: nullableStr,
  // AI SUGGESTION ONLY — never auto-applied. A device id must never silently
  // become a billing code; this is a hint for the operator to confirm later.
  proposed_billing_code_suggestion: nullableStr,
});
export type AiIntakeItem = z.infer<typeof AiIntakeItemSchema>;

export const AiIntakeResponseSchema = z.object({
  schema_version: z.string(),
  project_reference: nullableStr,
  // The prioritization text is preserved verbatim AND structured. The model must
  // not invent the meaning of priority terms (e.g. "66 work").
  priority_raw_text: nullableStr,
  priority_order: z.array(z.string()),
  // Sections the SUPPLIED DRAWING actually confirms (e.g. ["A1","B1","C1","D1"]).
  // Empty when no drawing was supplied or none could be confirmed.
  confirmed_sections: z.array(z.string()),
  items: z.array(AiIntakeItemSchema),
  warnings: z.array(z.string()),
});
export type AiIntakeResponse = z.infer<typeof AiIntakeResponseSchema>;

// ---- strict JSON schema handed to the OpenAI Responses API ------------------
// Every property is required and additionalProperties is false (OpenAI strict
// structured-output requirements). Optional values are expressed as nullable.
export function openAiJsonSchema() {
  const str = { type: ['string', 'null'] } as const;
  return {
    name: 'work_intake_extraction',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'schema_version',
        'project_reference',
        'priority_raw_text',
        'priority_order',
        'confirmed_sections',
        'items',
        'warnings',
      ],
      properties: {
        schema_version: { type: 'string' },
        project_reference: str,
        priority_raw_text: str,
        priority_order: { type: 'array', items: { type: 'string' } },
        confirmed_sections: { type: 'array', items: { type: 'string' } },
        warnings: { type: 'array', items: { type: 'string' } },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'device_id',
              'proposed_type',
              'route_section',
              'instructions',
              'reentry_required',
              'reentry_reason',
              'partial_work_allowed',
              'blocked_dependency',
              'dependencies',
              'confidence',
              'requires_review',
              'review_reason',
              'source_reference',
              'proposed_billing_code_suggestion',
            ],
            properties: {
              device_id: { type: 'string' },
              proposed_type: str,
              route_section: str,
              instructions: str,
              reentry_required: { type: 'boolean' },
              reentry_reason: str,
              partial_work_allowed: { type: 'boolean' },
              blocked_dependency: str,
              dependencies: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'number' },
              requires_review: { type: 'boolean' },
              review_reason: str,
              source_reference: str,
              proposed_billing_code_suggestion: str,
            },
          },
        },
      },
    },
  };
}

// Confidence tiers (business policy).
export const CONFIDENCE_HIGH = 0.9;
export const CONFIDENCE_REVIEW = 0.75; // < this => LOW => review required

export function confidenceTier(c: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (c >= CONFIDENCE_HIGH) return 'HIGH';
  if (c >= CONFIDENCE_REVIEW) return 'MEDIUM';
  return 'LOW';
}

// Parse the section suffix encoded in a device id, e.g. "NP0001.E1" -> "E1".
export function sectionFromDeviceId(deviceId: string): string | null {
  const m = /\.([A-Za-z]\d+)$/.exec(deviceId.trim());
  return m ? m[1].toUpperCase() : null;
}
