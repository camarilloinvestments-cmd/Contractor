export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { extractGrid, autoDetectMapping } from '@/lib/price-import';
import { isAiMappingConfigured, suggestMapping } from '@/lib/ai-price-map';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// Suggest a column mapping for an uploaded sheet. Falls back to deterministic
// detection if AI is not configured. Suggestion only — never activates pricing.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileType = file.type || (file.name.toLowerCase().endsWith('.csv') ? 'text/csv' : 'xlsx');
    const grid = await extractGrid(buffer, fileType);
    if (!grid.length) return NextResponse.json({ error: 'The file appears to be empty' }, { status: 400 });

    if (!isAiMappingConfigured()) {
      const fallback = autoDetectMapping(grid);
      return NextResponse.json({ aiConfigured: false, mapping: fallback, source: 'auto' }, { status: 200 });
    }
    try {
      const { mapping, rationale } = await suggestMapping(grid);
      return NextResponse.json({ aiConfigured: true, mapping, rationale, source: 'ai' });
    } catch (aiErr: any) {
      const fallback = autoDetectMapping(grid);
      return NextResponse.json({ aiConfigured: true, mapping: fallback, source: 'auto', aiError: aiErr?.message }, { status: 200 });
    }
  } catch (err: any) {
    console.error('AI map error:', err?.message);
    return NextResponse.json({ error: 'Failed to suggest mapping' }, { status: 500 });
  }
}
