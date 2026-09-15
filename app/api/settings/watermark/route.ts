export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import {
  getWatermarkSettings,
  WATERMARK_SETTINGS_ID,
  DEFAULT_WATERMARK_SETTINGS,
} from '@/lib/evidence/photo-evidence';

// Photo-watermark / evidence settings (spec §7). Admin-only.

const BOOL_FIELDS = [
  'enabled', 'showLogo', 'showCompanyName', 'showWorkOrder', 'showProject',
  'showTaskCode', 'showTechnician', 'showGpsCoords', 'showGpsAccuracy',
  'showAddress', 'showDate', 'showTime', 'showCompassHeading', 'showPhotoReference',
] as const;

const VALID_POSITIONS = ['BOTTOM', 'TOP'];
const VALID_POLICIES = ['REQUIRED', 'WARN', 'OPTIONAL'];

export async function GET() {
  const session = await auth();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'PROJECT_MANAGER')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await getWatermarkSettings();
  return NextResponse.json(settings);
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};

    for (const key of BOOL_FIELDS) {
      if (key in body) data[key] = Boolean(body[key]);
    }
    if ('position' in body) {
      const pos = String(body.position).toUpperCase();
      if (!VALID_POSITIONS.includes(pos)) {
        return NextResponse.json({ error: 'Invalid position' }, { status: 400 });
      }
      data.position = pos;
    }
    if ('gpsPolicy' in body) {
      const pol = String(body.gpsPolicy).toUpperCase();
      if (!VALID_POLICIES.includes(pol)) {
        return NextResponse.json({ error: 'Invalid GPS policy' }, { status: 400 });
      }
      data.gpsPolicy = pol;
    }
    if ('opacityPercent' in body) {
      const op = Math.round(Number(body.opacityPercent));
      if (!Number.isFinite(op) || op < 0 || op > 100) {
        return NextResponse.json({ error: 'Opacity must be 0-100' }, { status: 400 });
      }
      data.opacityPercent = op;
    }
    if ('maxAccuracyMeters' in body) {
      const ma = Math.round(Number(body.maxAccuracyMeters));
      if (!Number.isFinite(ma) || ma < 1 || ma > 1000) {
        return NextResponse.json({ error: 'Max accuracy must be 1-1000 meters' }, { status: 400 });
      }
      data.maxAccuracyMeters = ma;
    }
    if ('fieldTimezone' in body) {
      const tz = String(body.fieldTimezone).trim();
      // Validate IANA timezone.
      try { Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch {
        return NextResponse.json({ error: 'Invalid IANA timezone' }, { status: 400 });
      }
      data.fieldTimezone = tz;
    }
    if ('geocodeProvider' in body) {
      const gp = String(body.geocodeProvider).toLowerCase();
      if (!['nominatim', 'none'].includes(gp)) {
        return NextResponse.json({ error: 'Invalid geocode provider. Allowed: nominatim, none' }, { status: 400 });
      }
      data.geocodeProvider = gp;
    }

    const saved = await prisma.watermarkSettings.upsert({
      where: { id: WATERMARK_SETTINGS_ID },
      create: { id: WATERMARK_SETTINGS_ID, ...DEFAULT_WATERMARK_SETTINGS, ...data },
      update: data,
    });

    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'evidence.watermark_settings_updated',
      entityType: 'WatermarkSettings',
      entityId: saved.id,
      metadata: { fields: Object.keys(data) },
      ...requestMeta(req),
    });

    return NextResponse.json(saved);
  } catch (err: any) {
    console.error('Watermark settings update error:', err?.message);
    return NextResponse.json({ error: 'Failed to update watermark settings' }, { status: 500 });
  }
}
