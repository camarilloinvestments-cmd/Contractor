// Workstream I: OPTIONAL AI-assisted column mapping for rate-sheet imports.
//
// This is a *suggestion-only* helper. It never activates pricing and never
// bypasses the human APPROVE IMPORT step. If no AI endpoint is configured the
// caller degrades gracefully to the deterministic autoDetectMapping in
// lib/price-import.ts. The endpoint is a configurable OpenAI-compatible chat
// completions API (works with the Abacus RouteLLM endpoint or any compatible
// provider) via env vars:
//   AI_API_KEY   - bearer token (required to enable AI mapping)
//   AI_API_BASE  - base URL (default https://api.openai.com/v1)
//   AI_MODEL     - model name (default gpt-4o-mini)
import type { ColumnMapping } from '@/lib/price-import';

export function isAiMappingConfigured(): boolean {
  return !!process.env.AI_API_KEY;
}

type SuggestResult = {
  mapping: ColumnMapping;
  rationale?: string;
};

// Ask the model which columns map to which fields. We only send the first few
// rows (headers + a small sample) so no bulk/confidential data leaves the box,
// and the model is instructed to return strict JSON of 0-based column indexes.
export async function suggestMapping(grid: string[][]): Promise<SuggestResult> {
  if (!isAiMappingConfigured()) {
    throw new Error('AI mapping is not configured');
  }
  const base = (process.env.AI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  const sample = grid.slice(0, 8).map((r) => r.slice(0, 24));

  const system =
    'You map spreadsheet columns to a fixed schema for a construction rate sheet. ' +
    'Return ONLY strict JSON, no prose. The schema fields are: headerRowIndex, ' +
    'jobCode, description, unit, rate, category, notes. Each field except ' +
    'headerRowIndex is the 0-based COLUMN index in the grid, or -1 if not present. ' +
    'headerRowIndex is the 0-based ROW index of the header row.';
  const user =
    'Here are the first rows of the sheet as a JSON array of arrays (row-major):\n' +
    JSON.stringify(sample) +
    '\nReturn JSON like {"headerRowIndex":0,"jobCode":0,"description":1,"unit":2,"rate":3,"category":4,"notes":5}.';

  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`AI provider error (${resp.status}): ${text.slice(0, 200)}`);
  }
  const data: any = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI provider returned no content');

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('AI provider returned invalid JSON');
  }

  const num = (v: any, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : d);
  const mapping: ColumnMapping = {
    headerRowIndex: num(parsed.headerRowIndex, 0),
    jobCode: num(parsed.jobCode, -1),
    description: num(parsed.description, -1),
    unit: num(parsed.unit, -1),
    rate: num(parsed.rate, -1),
    category: num(parsed.category, -1),
    notes: num(parsed.notes, -1),
  };
  return { mapping, rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined };
}
