// Outbound email transport (Phase 1 / v1.1.0, extended Phase 2 / v1.2.0).
//
// Builds a nodemailer transport from the stored EmailSettings using the explicit
// transport-mode abstraction (STARTTLS / IMPLICIT_TLS / NONE) and either PASSWORD
// or OAUTH2 auth, decrypts credentials fail-closed (lib/crypto), sends the
// message, and records every attempt in EmailLog. Sending is disabled unless
// EmailSettings.enabled is true and a host + From address + usable credentials
// are available. Secrets are never logged.
import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';
import { getEmailSettingsRaw, decryptEmailSecrets } from './settings';
import { buildTransport as buildTransportOptions } from './transport';
import { categorizeEmailError } from './errors';

export type SendEmailInput = {
  to: string;
  cc?: string | null;
  subject: string;
  html: string;
  text?: string;
  templateKey?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  sentById?: string | null;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
};

export type SendEmailResult = {
  ok: boolean;
  messageId?: string;
  error?: string; // safe, categorized, operator-facing message
  errorCategory?: string;
  logId?: string;
};

export class EmailNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailNotConfiguredError';
  }
}

async function buildTransport() {
  const settings = await getEmailSettingsRaw();
  if (!settings || !settings.enabled) {
    throw new EmailNotConfiguredError('Email sending is disabled. Enable and configure SMTP in Settings.');
  }
  if (!settings.host || !settings.fromEmail) {
    throw new EmailNotConfiguredError('SMTP host and From address are required.');
  }

  // Decrypt secrets fail-closed (throws if key missing but ciphertext present).
  const secrets = decryptEmailSecrets(settings);

  const built = buildTransportOptions(
    {
      host: settings.host,
      port: settings.port,
      transportMode: settings.transportMode,
      secure: settings.secure,
      authMethod: settings.authMethod,
      username: settings.username,
      fromEmail: settings.fromEmail,
      oauthClientId: settings.oauthClientId,
      oauthTenantId: settings.oauthTenantId,
    },
    {
      password: secrets.password,
      oauthClientSecret: secrets.oauthClientSecret,
      oauthRefreshToken: secrets.oauthRefreshToken,
    }
  );

  const transport = nodemailer.createTransport(built.options as unknown as Parameters<typeof nodemailer.createTransport>[0]);
  return { transport, settings, mode: built.mode, authMethod: built.authMethod };
}

// Verify SMTP connectivity without sending (used by the settings test button flow).
// Returns a safe categorized error message on failure (never the raw error).
export async function verifyTransport(): Promise<{ ok: boolean; error?: string; errorCategory?: string }> {
  try {
    const { transport } = await buildTransport();
    await transport.verify();
    return { ok: true };
  } catch (err) {
    const cat = categorizeEmailError(err);
    return { ok: false, error: cat.message, errorCategory: cat.category };
  }
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // Create the log row up-front in QUEUED state.
  let logId: string | undefined;
  try {
    const log = await prisma.emailLog.create({
      data: {
        toAddress: input.to,
        ccAddress: input.cc ?? null,
        subject: input.subject,
        templateKey: input.templateKey ?? null,
        status: 'QUEUED',
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        sentById: input.sentById ?? null,
      },
    });
    logId = log.id;
  } catch (err) {
    console.error('[mailer] failed to create email log:', (err as Error)?.message);
  }

  try {
    const { transport, settings } = await buildTransport();
    const fromName = settings.fromName || 'OS1 Fiber Track Pro';
    const info = (await transport.sendMail({
      from: `"${fromName}" <${settings.fromEmail}>`,
      to: input.to,
      cc: input.cc ?? undefined,
      replyTo: settings.replyTo ?? undefined,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments,
    })) as { messageId?: string };

    if (logId) {
      await prisma.emailLog.update({
        where: { id: logId },
        data: {
          status: 'SENT',
          provider: settings.provider || 'smtp',
          messageId: info.messageId,
          sentAt: new Date(),
        },
      });
    }
    return { ok: true, messageId: info.messageId, logId };
  } catch (err) {
    // Store the categorized, safe message. The raw message may contain sensitive
    // details, so it is intentionally NOT persisted or returned to callers.
    const cat = categorizeEmailError(err);
    if (logId) {
      await prisma.emailLog
        .update({ where: { id: logId }, data: { status: 'FAILED', error: cat.message } })
        .catch(() => undefined);
    }
    return { ok: false, error: cat.message, errorCategory: cat.category, logId };
  }
}
