// Outbound email transport (Phase 1 / v1.1.0).
//
// Builds a nodemailer transport from the stored EmailSettings, decrypts the SMTP
// password fail-closed (lib/crypto), sends the message, and records every attempt
// in EmailLog. Sending is disabled unless EmailSettings.enabled is true and a
// host + decryptable password are available.
import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';
import { decryptSecret, isEncryptionAvailable } from '@/lib/crypto';
import { getEmailSettingsRaw } from './settings';

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
  error?: string;
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
  if (!settings.passwordEncrypted) {
    throw new EmailNotConfiguredError('SMTP password is not set.');
  }
  if (!isEncryptionAvailable()) {
    throw new EmailNotConfiguredError('APP_ENCRYPTION_KEY is not configured; cannot decrypt SMTP password.');
  }
  const password = decryptSecret(settings.passwordEncrypted);
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port ?? 587,
    secure: !!settings.secure,
    auth: settings.username ? { user: settings.username, pass: password } : undefined,
  });
  return { transport, settings };
}

// Verify SMTP connectivity without sending (used by the settings test button flow).
export async function verifyTransport(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { transport } = await buildTransport();
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? 'verification failed' };
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
    const fromName = settings.fromName || 'FiberTrack Pro';
    const info = await transport.sendMail({
      from: `"${fromName}" <${settings.fromEmail}>`,
      to: input.to,
      cc: input.cc ?? undefined,
      replyTo: settings.replyTo ?? undefined,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments,
    });

    if (logId) {
      await prisma.emailLog.update({
        where: { id: logId },
        data: {
          status: 'SENT',
          provider: 'smtp',
          messageId: info.messageId,
          sentAt: new Date(),
        },
      });
    }
    return { ok: true, messageId: info.messageId, logId };
  } catch (err) {
    const message = (err as Error)?.message ?? 'send failed';
    if (logId) {
      await prisma.emailLog
        .update({ where: { id: logId }, data: { status: 'FAILED', error: message } })
        .catch(() => undefined);
    }
    return { ok: false, error: message, logId };
  }
}
