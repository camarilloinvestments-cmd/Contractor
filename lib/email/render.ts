// Safe email template renderer (Phase 1 / ruling #10).
//
// Replaces {{variable}} tokens using ONLY the allow-listed variable set. This is
// a pure string replace — no eval, no function constructor, no property lookups
// beyond the provided plain-object values. Tokens that are not in the allow-list
// are left as-is by default (so authors can see the mistake) and can optionally
// be stripped.
import { ALLOWED_VARIABLES, isAllowedVariable, type TemplateVariables } from './allowlist';

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function renderTemplate(
  template: string,
  variables: TemplateVariables,
  opts: { stripUnknown?: boolean } = {}
): string {
  if (!template) return '';
  return template.replace(TOKEN_RE, (match, rawName: string) => {
    const name = rawName.trim();
    if (isAllowedVariable(name)) {
      const value = variables[name];
      return value == null ? '' : String(value);
    }
    // Unknown / disallowed token.
    return opts.stripUnknown ? '' : match;
  });
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
