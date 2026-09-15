// Server-side field-photo watermark generator (spec §5, §6, §8).
//
// Loads the ORIGINAL image bytes and composites a semi-transparent evidence
// panel (company branding + work/GPS context) onto a copy. The original is
// never mutated — callers persist both objects with separate SHA-256 hashes.
//
// Branding is resolved from the SAME shared source used by invoices/quotes/
// statements (lib/branding.ts) — there is no second logo system (§6).

import sharp from 'sharp';
import { getCompanyProfile, getBrandingLogoBytes, type CompanyBranding } from '@/lib/branding';

export interface WatermarkFieldSettings {
  enabled: boolean;
  showLogo: boolean;
  showCompanyName: boolean;
  showWorkOrder: boolean;
  showProject: boolean;
  showTaskCode: boolean;
  showTechnician: boolean;
  showGpsCoords: boolean;
  showGpsAccuracy: boolean;
  showAddress: boolean;
  showDate: boolean;
  showTime: boolean;
  showCompassHeading: boolean;
  showPhotoReference: boolean;
  position: string; // BOTTOM | TOP
  opacityPercent: number; // 0-100
}

export interface WatermarkContext {
  workOrderNumber?: string | null;
  projectName?: string | null;
  taskCode?: string | null;
  technicianName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  gpsAccuracyMeters?: number | null;
  heading?: number | null;
  address?: string | null;
  capturedAt: Date;
  evidenceRef: string;
}

export interface WatermarkResult {
  buffer: Buffer;
  contentType: string;
  ext: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' });
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC';
}

/** Build the list of text lines to render, honoring the per-field toggles. */
export function buildWatermarkLines(
  settings: WatermarkFieldSettings,
  ctx: WatermarkContext,
  branding: CompanyBranding
): string[] {
  const lines: string[] = [];
  if (settings.showCompanyName && branding.companyName) lines.push(branding.companyName);
  if (settings.showWorkOrder && ctx.workOrderNumber) lines.push(`WO: ${ctx.workOrderNumber}`);
  if (settings.showProject && ctx.projectName) lines.push(`Project: ${ctx.projectName}`);
  if (settings.showTaskCode && ctx.taskCode) lines.push(`Task/Code: ${ctx.taskCode}`);
  if (settings.showTechnician && ctx.technicianName) lines.push(`Tech: ${ctx.technicianName}`);

  const dt: string[] = [];
  if (settings.showDate) dt.push(fmtDate(ctx.capturedAt));
  if (settings.showTime) dt.push(fmtTime(ctx.capturedAt));
  if (dt.length) lines.push(dt.join('  '));

  if (settings.showGpsCoords && ctx.latitude != null && ctx.longitude != null) {
    let g = `GPS: ${ctx.latitude.toFixed(6)}, ${ctx.longitude.toFixed(6)}`;
    if (settings.showGpsAccuracy && ctx.gpsAccuracyMeters != null) g += `  (±${Math.round(ctx.gpsAccuracyMeters)} m)`;
    lines.push(g);
  } else if (settings.showGpsAccuracy && ctx.gpsAccuracyMeters != null) {
    lines.push(`GPS accuracy: ±${Math.round(ctx.gpsAccuracyMeters)} m`);
  }
  if (settings.showCompassHeading && ctx.heading != null) lines.push(`Heading: ${Math.round(ctx.heading)}°`);
  if (settings.showAddress && ctx.address) lines.push(ctx.address);
  if (settings.showPhotoReference && ctx.evidenceRef) lines.push(`Ref: ${ctx.evidenceRef}`);
  return lines;
}

/**
 * Generate a watermarked derivative from the original image bytes.
 * Returns a NEW buffer; the input buffer is not modified.
 */
export async function generateWatermark(
  originalBytes: Buffer,
  settings: WatermarkFieldSettings,
  ctx: WatermarkContext,
  brandingArg?: CompanyBranding
): Promise<WatermarkResult> {
  const branding = brandingArg ?? (await getCompanyProfile());
  const base = sharp(originalBytes, { failOn: 'none' }).rotate(); // honor EXIF orientation on the derivative only
  const meta = await base.metadata();
  const width = meta.width ?? 1200;
  const height = meta.height ?? 900;

  const lines = buildWatermarkLines(settings, ctx, branding);

  // Panel geometry — scale with image width so text stays readable.
  const pad = Math.round(width * 0.02);
  const fontSize = Math.max(14, Math.round(width * 0.022));
  const lineHeight = Math.round(fontSize * 1.4);
  const logoBytesResult = settings.showLogo ? await getBrandingLogoBytes(branding) : null;
  const logoSize = logoBytesResult ? Math.round(fontSize * (lines.length > 0 ? 3.2 : 2)) : 0;
  const textBlockHeight = lines.length * lineHeight;
  const panelHeight = Math.max(textBlockHeight, logoSize) + pad * 2;
  const panelY = settings.position === 'TOP' ? 0 : height - panelHeight;
  const opacity = Math.min(0.95, Math.max(0.15, (settings.opacityPercent ?? 55) / 100));

  const logoW = logoSize;
  const textX = pad + (logoW ? logoW + pad : 0);
  const accent = branding.accentColor || '#0891b2';

  // Prepare (and normalize) the logo as a PNG buffer we can composite.
  let logoPng: Buffer | null = null;
  if (logoBytesResult) {
    try {
      logoPng = await sharp(logoBytesResult.buffer, { failOn: 'none' })
        .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    } catch {
      logoPng = null; // never fail the whole derivative on a bad logo
    }
  }

  const textStartY = panelY + pad + fontSize;
  const textSvgLines = lines
    .map((ln, i) => {
      const weight = i === 0 && settings.showCompanyName ? '700' : '400';
      const fill = i === 0 && settings.showCompanyName ? '#ffffff' : '#f1f5f9';
      return `<text x="${textX}" y="${textStartY + i * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${escapeXml(ln)}</text>`;
    })
    .join('');

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${panelY}" width="${width}" height="${panelHeight}" fill="#0f172a" fill-opacity="${opacity}"/>
    <rect x="0" y="${settings.position === 'TOP' ? panelHeight - 3 : panelY}" width="${width}" height="3" fill="${escapeXml(accent)}"/>
    ${textSvgLines}
  </svg>`;

  const composites: { input: Buffer; top: number; left: number }[] = [{ input: Buffer.from(svg), top: 0, left: 0 }];
  if (logoPng) {
    const logoTop = panelY + Math.round((panelHeight - logoSize) / 2);
    composites.push({ input: logoPng, top: logoTop, left: pad });
  }

  // Flatten (drops alpha) and output JPEG for a compact, universally-viewable
  // evidence derivative. The original object keeps its own format/bytes.
  const out = await base
    .composite(composites)
    .jpeg({ quality: 90 })
    .toBuffer();

  return { buffer: out, contentType: 'image/jpeg', ext: 'jpg' };
}
