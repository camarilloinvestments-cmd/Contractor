// Field photo evidence service helpers (spec §2, §8, §9, §10).
// Server-only: pulls original bytes from storage, generates the watermarked
// derivative, and persists both hashes. Never mutates the original object.

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { getObjectBytes, uploadBuffer } from '@/lib/s3';
import { getCompanyProfile } from '@/lib/branding';
import { generateWatermark, type WatermarkFieldSettings, type WatermarkContext } from './watermark';

export const WATERMARK_SETTINGS_ID = 'default';

export interface WatermarkSettingsShape extends WatermarkFieldSettings {
  gpsPolicy: string; // REQUIRED | WARN | OPTIONAL
  maxAccuracyMeters: number;
  fieldTimezone: string; // IANA timezone for watermark display
  geocodeProvider: string; // nominatim | none
}

export const DEFAULT_WATERMARK_SETTINGS: WatermarkSettingsShape = {
  enabled: true,
  showLogo: true,
  showCompanyName: true,
  showWorkOrder: true,
  showProject: true,
  showTaskCode: true,
  showTechnician: true,
  showGpsCoords: true,
  showGpsAccuracy: true,
  showAddress: true,
  showDate: true,
  showTime: true,
  showCompassHeading: false,
  showPhotoReference: true,
  position: 'BOTTOM',
  opacityPercent: 55,
  gpsPolicy: 'REQUIRED',
  maxAccuracyMeters: 30,
  fieldTimezone: 'America/Chicago',
  geocodeProvider: 'nominatim',
};

/** Load the watermark settings singleton, falling back to safe defaults. */
export async function getWatermarkSettings(): Promise<WatermarkSettingsShape> {
  try {
    const row = await prisma.watermarkSettings.findUnique({ where: { id: WATERMARK_SETTINGS_ID } });
    if (!row) return { ...DEFAULT_WATERMARK_SETTINGS };
    return {
      enabled: row.enabled,
      showLogo: row.showLogo,
      showCompanyName: row.showCompanyName,
      showWorkOrder: row.showWorkOrder,
      showProject: row.showProject,
      showTaskCode: row.showTaskCode,
      showTechnician: row.showTechnician,
      showGpsCoords: row.showGpsCoords,
      showGpsAccuracy: row.showGpsAccuracy,
      showAddress: row.showAddress,
      showDate: row.showDate,
      showTime: row.showTime,
      showCompassHeading: row.showCompassHeading,
      showPhotoReference: row.showPhotoReference,
      position: row.position,
      opacityPercent: row.opacityPercent,
      gpsPolicy: row.gpsPolicy,
      maxAccuracyMeters: row.maxAccuracyMeters,
      fieldTimezone: (row as any).fieldTimezone ?? 'America/Chicago',
      geocodeProvider: (row as any).geocodeProvider ?? 'nominatim',
    };
  } catch {
    return { ...DEFAULT_WATERMARK_SETTINGS };
  }
}

/** SHA-256 hex digest of a buffer (tamper-evidence §2/§9). */
export function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Generate and persist the watermarked derivative for an evidence record.
 * Reads the ORIGINAL bytes (unchanged), composites the watermark, uploads the
 * derivative to its own storage path, and records a separate SHA-256.
 * Returns the updated record. On failure, records watermarkError + FAILED and
 * rethrows so the caller can surface it (original is always preserved).
 */
export async function generateAndPersistWatermark(evidenceId: string): Promise<void> {
  const rec = await prisma.fieldPhotoEvidence.findUnique({ where: { id: evidenceId } });
  if (!rec) throw new Error('Evidence record not found');

  const settings = await getWatermarkSettings();
  if (!settings.enabled) {
    // Watermarking disabled by policy — leave original only, mark handled.
    await prisma.fieldPhotoEvidence.update({
      where: { id: evidenceId },
      data: { status: 'UPLOADED', watermarkError: null },
    });
    return;
  }

  try {
    const originalBytes = await getObjectBytes(rec.originalStoragePath);
    if (!originalBytes) throw new Error('Original bytes unavailable for watermarking');

    const branding = await getCompanyProfile();
    let projectName: string | null = null;
    if (rec.projectId) {
      const proj = await prisma.project.findUnique({ where: { id: rec.projectId }, select: { projectName: true, projectCode: true } });
      projectName = proj?.projectName ?? proj?.projectCode ?? null;
    }
    let workOrderNumber: string | null = null;
    const job = await prisma.job.findUnique({ where: { id: rec.jobId }, select: { jobNumber: true } });
    workOrderNumber = job?.jobNumber ?? null;
    let taskCode: string | null = null;
    if (rec.taskId) {
      const task = await prisma.task.findUnique({ where: { id: rec.taskId }, select: { billingCode: true, description: true } });
      taskCode = task?.billingCode ?? task?.description ?? null;
    }

    const ctx: WatermarkContext = {
      workOrderNumber,
      projectName,
      taskCode,
      technicianName: rec.technicianName,
      latitude: rec.latitude,
      longitude: rec.longitude,
      gpsAccuracyMeters: rec.gpsAccuracyMeters,
      heading: rec.heading,
      address: rec.address,
      capturedAt: rec.capturedAt,
      evidenceRef: rec.evidenceRef,
      fieldTimezone: settings.fieldTimezone,
    };

    const result = await generateWatermark(originalBytes, settings, ctx, branding);
    const watermarkedSha256 = sha256Hex(result.buffer);
    const baseName = rec.evidenceRef.replace(/[^A-Za-z0-9._-]/g, '_');
    const uploaded = await uploadBuffer(
      result.buffer,
      `${baseName}-watermarked.${result.ext}`,
      result.contentType,
      'evidence/watermarked'
    );

    await prisma.fieldPhotoEvidence.update({
      where: { id: evidenceId },
      data: {
        watermarkedStoragePath: uploaded.cloud_storage_path,
        watermarkedSha256,
        watermarkedContentType: result.contentType,
        watermarkGeneratedAt: new Date(),
        watermarkError: null,
        status: 'WATERMARKED',
      },
    });
  } catch (err: any) {
    await prisma.fieldPhotoEvidence.update({
      where: { id: evidenceId },
      data: { watermarkError: String(err?.message ?? err).slice(0, 500), status: 'FAILED' },
    });
    throw err;
  }
}
