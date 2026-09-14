// Phase 2 — transport abstraction.
//
// Turns a stored EmailSettings row (+ its decrypted secrets) into concrete
// nodemailer transport options. The transport mode is explicit — STARTTLS,
// IMPLICIT_TLS or NONE — so there is never an ambiguous "secure" boolean guess:
//
//   STARTTLS      secure:false + requireTLS:true  (upgrade to TLS after connect)
//   IMPLICIT_TLS  secure:true                     (TLS from the first byte)
//   NONE          secure:false + ignoreTLS:true   (no encryption; discouraged)
//
// Authentication is either PASSWORD (username + decrypted password) or OAUTH2
// (username + clientId/clientSecret/refreshToken, exchanged by nodemailer at
// send time; for Microsoft 365 the tenant token endpoint is supplied as
// accessUrl). Secrets are passed in already-decrypted by the caller and are
// never logged.
import type { TransportMode, AuthMethod } from './providers';

export interface TransportSecrets {
  password?: string | null;
  oauthClientSecret?: string | null;
  oauthRefreshToken?: string | null;
}

export interface TransportSettingsRow {
  host: string | null;
  port: number | null;
  transportMode?: string | null;
  secure?: boolean | null; // legacy fallback
  authMethod?: string | null;
  username: string | null;
  fromEmail: string | null;
  oauthClientId?: string | null;
  oauthTenantId?: string | null;
}

export interface BuiltTransport {
  options: Record<string, unknown>;
  mode: TransportMode;
  authMethod: AuthMethod;
}

export class TransportConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportConfigError';
  }
}

// Resolve the transport mode, tolerating legacy rows that only stored `secure`.
export function resolveTransportMode(row: TransportSettingsRow): TransportMode {
  const m = (row.transportMode || '').toUpperCase();
  if (m === 'STARTTLS' || m === 'IMPLICIT_TLS' || m === 'NONE') return m;
  // Legacy fallback: secure=true meant implicit TLS (465), otherwise STARTTLS.
  return row.secure ? 'IMPLICIT_TLS' : 'STARTTLS';
}

export function resolveAuthMethod(row: TransportSettingsRow): AuthMethod {
  return (row.authMethod || '').toUpperCase() === 'OAUTH2' ? 'OAUTH2' : 'PASSWORD';
}

function modeToTls(mode: TransportMode): Record<string, unknown> {
  switch (mode) {
    case 'IMPLICIT_TLS':
      return { secure: true };
    case 'NONE':
      return { secure: false, ignoreTLS: true };
    case 'STARTTLS':
    default:
      return { secure: false, requireTLS: true };
  }
}

// Microsoft 365 tenant token endpoint for OAuth2.
function m365AccessUrl(tenantId?: string | null): string | undefined {
  if (!tenantId) return undefined;
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
}

export function buildTransport(row: TransportSettingsRow, secrets: TransportSecrets): BuiltTransport {
  if (!row.host) throw new TransportConfigError('SMTP host is required.');
  if (!row.fromEmail) throw new TransportConfigError('From address is required.');

  const mode = resolveTransportMode(row);
  const authMethod = resolveAuthMethod(row);
  const port = row.port ?? (mode === 'IMPLICIT_TLS' ? 465 : 587);

  const options: Record<string, unknown> = {
    host: row.host,
    port,
    ...modeToTls(mode),
  };

  if (authMethod === 'OAUTH2') {
    if (!row.username) throw new TransportConfigError('OAuth2 requires the mailbox username (user).');
    if (!row.oauthClientId) throw new TransportConfigError('OAuth2 requires a client ID.');
    if (!secrets.oauthClientSecret) throw new TransportConfigError('OAuth2 requires a client secret.');
    if (!secrets.oauthRefreshToken) throw new TransportConfigError('OAuth2 requires a refresh token.');
    const auth: Record<string, unknown> = {
      type: 'OAuth2',
      user: row.username,
      clientId: row.oauthClientId,
      clientSecret: secrets.oauthClientSecret,
      refreshToken: secrets.oauthRefreshToken,
    };
    const accessUrl = m365AccessUrl(row.oauthTenantId);
    if (accessUrl) auth.accessUrl = accessUrl;
    options.auth = auth;
  } else {
    // PASSWORD auth. Username optional only for open relays; almost always set.
    if (row.username) {
      if (!secrets.password) throw new TransportConfigError('SMTP password is not set.');
      options.auth = { user: row.username, pass: secrets.password };
    }
  }

  return { options, mode, authMethod };
}
