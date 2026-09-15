// OpenAI Responses API client for AI Work Intake.
//
// - Reads the API key from ENCRYPTED settings (never from source/env-only).
// - Uses the Responses API with a STRICT JSON schema (structured outputs).
// - Never logs the key, the prompt, or the untrusted data.
// - Supports a configurable normal model + a configurable stronger fallback
//   model (used on hard/low-confidence extractions). Business logic is never
//   hardcoded to a specific model name.
import { openAiJsonSchema } from './schema';
import { resolveOpenAiApiBase } from './openai-endpoint';

export type OpenAiContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'input_file'; filename: string; file_data: string };

export type OpenAiMessage = {
  role: 'system' | 'developer' | 'user';
  content: OpenAiContentPart[];
};

export type OpenAiCallResult = {
  ok: boolean;
  raw?: string; // JSON text (to be parsed + zod-validated by the caller)
  modelUsed?: string;
  error?: string; // sanitized; never contains the key
};

function sanitizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? 'unknown error');
  // Defense-in-depth: strip anything resembling an OpenAI key from error text.
  return msg.replace(/sk-[A-Za-z0-9_-]{10,}/g, '[REDACTED]').slice(0, 500);
}

// Extract the model's text output from a Responses API payload.
function extractOutputText(data: any): string | null {
  if (typeof data?.output_text === 'string' && data.output_text.length) return data.output_text;
  const out = data?.output;
  if (Array.isArray(out)) {
    const parts: string[] = [];
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (typeof c?.text === 'string') parts.push(c.text);
        }
      }
    }
    if (parts.length) return parts.join('');
  }
  return null;
}

async function callOnce(opts: {
  apiKey: string;
  apiBase?: string | null;
  model: string;
  messages: OpenAiMessage[];
  signal?: AbortSignal;
}): Promise<OpenAiCallResult> {
  try {
    // Blocker 1: pin the endpoint. A non-official (arbitrary/localhost/private)
    // base throws here, BEFORE the credential is ever attached to a request.
    const apiBase = resolveOpenAiApiBase(opts.apiBase);
    const res = await fetch(`${apiBase}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        input: opts.messages,
        text: { format: { type: 'json_schema', ...openAiJsonSchema() } },
        temperature: 0,
        max_output_tokens: 8000,
      }),
      signal: opts.signal,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        detail = body?.error?.message ? `${detail}: ${body.error.message}` : detail;
      } catch {
        /* ignore */
      }
      return { ok: false, error: sanitizeError(new Error(detail)) };
    }
    const data = await res.json();
    const text = extractOutputText(data);
    if (!text) return { ok: false, error: 'Model returned no structured output' };
    return { ok: true, raw: text, modelUsed: opts.model };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
}

// Run the extraction. Tries the normal model first; if it fails, retries once
// with the fallback model (when configured + different). The caller may also
// request the fallback directly (e.g. difficult drawings) via preferFallback.
export async function runExtraction(opts: {
  apiKey: string;
  apiBase?: string | null;
  normalModel: string;
  fallbackModel: string;
  messages: OpenAiMessage[];
  preferFallback?: boolean;
  signal?: AbortSignal;
}): Promise<OpenAiCallResult & { usedFallback: boolean }> {
  const first = opts.preferFallback && opts.fallbackModel ? opts.fallbackModel : opts.normalModel;
  const r1 = await callOnce({ ...opts, model: first });
  if (r1.ok) return { ...r1, usedFallback: first === opts.fallbackModel && first !== opts.normalModel };

  const second = first === opts.normalModel ? opts.fallbackModel : opts.normalModel;
  if (second && second !== first) {
    const r2 = await callOnce({ ...opts, model: second });
    if (r2.ok) return { ...r2, usedFallback: second === opts.fallbackModel && second !== opts.normalModel };
    return { ...r2, usedFallback: false };
  }
  return { ...r1, usedFallback: false };
}

// Minimal, cheap connectivity check for the settings "Test Connection" button.
// Does not send any intake data. Returns a sanitized result.
export async function testConnection(opts: {
  apiKey: string;
  apiBase?: string | null;
  model: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    // Blocker 1: Test Connection is held to the exact same pinned-endpoint policy
    // as live extraction — it cannot be used to probe an arbitrary URL with the key.
    const apiBase = resolveOpenAiApiBase(opts.apiBase);
    const res = await fetch(`${apiBase}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model,
        input: 'Reply with the single word: ok',
        max_output_tokens: 16,
      }),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        detail = body?.error?.message ? `${detail}: ${body.error.message}` : detail;
      } catch {
        /* ignore */
      }
      return { ok: false, error: sanitizeError(new Error(detail)) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
}
