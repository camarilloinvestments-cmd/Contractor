// Safe email template renderer (Phase 1 / ruling #10).
//
// Replaces {{variable}} tokens using ONLY the allow-listed variable set. This is
// a pure string replace — no eval, no function constructor, no property lookups
// beyond the provided plain-object values. Tokens that are not in the allow-list
// are left as-is by default (so authors can see the mistake) and can optionally
// be stripped.
import { ALLOWED_VARIABLES, isAllowedVariable, type TemplateVariables } from './allowlist';

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;
// Conditional block (ruling #5): {{#if var}} ... {{/if}}. Non-greedy so
// sequential blocks each bind to their own {{/if}}.
const IF_BLOCK_RE = /\{\{\s*#if\s+([a-z_]+)\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g;

function hasValue(name: string, variables: TemplateVariables): boolean {
  if (!isAllowedVariable(name)) return false;
  const value = variables[name];
  return value != null && String(value).trim() !== '';
}

// Resolve {{#if var}}...{{/if}} blocks BEFORE token substitution. A block whose
// variable is absent/empty is dropped in full — including its static wording
// (e.g. " for project ", "This estimate is valid until ") — so missing optional
// fields never leave dangling punctuation, blank labels, or null/undefined
// artifacts. Bounded loop also resolves blocks nested inside kept blocks. There
// is NO expression evaluation: the only test is presence of one named,
// allow-listed variable.
function resolveConditionals(template: string, variables: TemplateVariables): string {
  let out = template;
  let guard = 0;
  while (IF_BLOCK_RE.test(out) && guard < 20) {
    IF_BLOCK_RE.lastIndex = 0;
    out = out.replace(IF_BLOCK_RE, (_m, rawName: string, inner: string) =>
      hasValue(rawName.trim(), variables) ? inner : ''
    );
    guard += 1;
  }
  IF_BLOCK_RE.lastIndex = 0;
  return out;
}

// Conservative post-substitution cleanup: removes residual artifacts left by an
// empty inline variable (stray double space, space before punctuation) WITHOUT
// touching newlines or legitimate content. Safety net; {{#if}} is the primary
// mechanism for optional phrases.
function sanitize(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]+$/gm, '');
}

export function renderTemplate(
  template: string,
  variables: TemplateVariables,
  opts: { stripUnknown?: boolean } = {}
): string {
  if (!template) return '';
  const withConditionals = resolveConditionals(template, variables);
  const replaced = withConditionals.replace(TOKEN_RE, (match, rawName: string) => {
    const name = rawName.trim();
    if (isAllowedVariable(name)) {
      const value = variables[name];
      return value == null ? '' : String(value);
    }
    // Unknown / disallowed token.
    return opts.stripUnknown ? '' : match;
  });
  return sanitize(replaced);
}

// Extract the distinct {{variables}} referenced by a template (for UI validation).
export function extractVariables(template: string): { allowed: string[]; unknown: string[] } {
  const allowed = new Set<string>();
  const unknown = new Set<string>();
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(template)) !== null) {
    const name = m[1].trim();
    if (isAllowedVariable(name)) allowed.add(name);
    else unknown.add(name);
  }
  return { allowed: [...allowed], unknown: [...unknown] };
}

export { ALLOWED_VARIABLES };
