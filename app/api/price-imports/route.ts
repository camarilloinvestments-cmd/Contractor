export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { extractGrid, autoDetectMapping, buildRows, buildSummary, PriceImportError, type ColumnMapping, type ImportStage } from '@/lib/price-import';

const STAGE_STATUS: Record<ImportStage, number> = {
  'workbook-parsing': 400,
  'mapping': 422,
  'validation': 422,
  'staging-database': 500,
};

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// POST multipart/form-data: file, primeContractorId, priceBookId, [mapping JSON], [usedAi]
// Parses the sheet in-memory, builds a preview diff against the target book's
// current lines, and stores a PENDING PriceImport record. NOTHING becomes
// active until /approve.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const primeContractorId = String(form.get('primeContractorId') || '');
    const priceBookId = String(form.get('priceBookId') || '');
    const usedAi = String(form.get('usedAi') || '') === 'true';
    const mappingRaw = form.get('mapping');
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    if (!primeContractorId || !priceBookId) {
      return NextResponse.json({ error: 'primeContractorId and priceBookId are required' }, { status: 400 });
    }
    const book = await prisma.priceBook.findUnique({ where: { id: priceBookId }, include: { lines: true } });
    if (!book) return NextResponse.json({ error: 'Price book not found' }, { status: 404 });
    if (book.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Imports can only target a draft price book' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileType = file.type || (file.name.toLowerCase().endsWith('.csv') ? 'text/csv' : 'xlsx');

    // Stage 1: workbook parsing
    let grid: string[][];
    try {
      grid = await extractGrid(buffer, fileType);
    } catch (e) {
      if (e instanceof PriceImportError) throw e;
      throw new PriceImportError('workbook-parsing', `Unable to read the uploaded file: ${(e as any)?.message || 'unknown error'}`);
    }
    if (!grid.length) throw new PriceImportError('workbook-parsing', 'The file appears to be empty.');

    // Stage 2: column mapping
    let mapping: ColumnMapping | null = null;
    if (mappingRaw) {
      try { mapping = JSON.parse(String(mappingRaw)); } catch { mapping = null; }
    }
    if (!mapping) mapping = autoDetectMapping(grid);
    if (!mapping) {
      throw new PriceImportError('mapping', 'Could not detect the Job Code, Description, Unit and Rate columns. Please map columns manually.');
    }

    // Stage 3: row validation (per-row problems are collected as errorRows,
    // not thrown; a fatal condition here would be no parseable data at all).
    const { rows, errors } = buildRows(grid, mapping);
    if (rows.length === 0 && errors.length === 0) {
      throw new PriceImportError('validation', 'No data rows were found beneath the header row.');
    }
    const summary = buildSummary(rows, errors, book.lines.map((l) => ({ jobCode: l.jobCode, ratePerUnit: l.ratePerUnit })));

    // Stage 4: persist the staged (PENDING) import
    let record;
    try {
      record = await prisma.priceImport.create({
      data: {
        primeContractorId,
        priceBookId,
        originalFilename: file.name,
        fileType,
        status: 'PENDING',
        usedAi,
        finalMapping: mapping as any,
        parsedRows: rows as any,
        summary: summary as any,
        errorRows: errors as any,
        createdById: session.user.id,
      },
      });
    } catch (e) {
      throw new PriceImportError('staging-database', `Failed to save the staged import: ${(e as any)?.message || 'unknown database error'}`);
    }
    return NextResponse.json({ import: record, summary, mapping, errorCount: errors.length });
  } catch (err: any) {
    if (err instanceof PriceImportError) {
      console.error(`Price import failed [stage=${err.stage}]:`, err.message);
      return NextResponse.json({ error: err.message, stage: err.stage }, { status: STAGE_STATUS[err.stage] });
    }
    console.error('Price import error (unclassified):', err?.message);
    return NextResponse.json({ error: 'Unexpected error while processing the import.', stage: 'unknown' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const priceBookId = searchParams.get('priceBookId');
  const primeId = searchParams.get('primeId');
  const where: any = {};
  if (priceBookId) where.priceBookId = priceBookId;
  if (primeId) where.primeContractorId = primeId;
  const imports = await prisma.priceImport.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 50,
    select: { id: true, originalFilename: true, status: true, usedAi: true, summary: true, createdAt: true, approvedAt: true },
  });
  return NextResponse.json(imports);
}
