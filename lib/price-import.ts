// Workstream H/I: rate-sheet parsing, validation, diff, and Excel generation.
// Pure functions operating on buffers/arrays so they are unit-testable and free
// of any prime-contractor-specific assumptions. The basic importer works with
// NO AI; AI only *suggests* a column mapping that a human then approves.
import ExcelJS from 'exceljs';
import { dollarsToCents } from '@/lib/utils/format';

// Failure stages so the API can tell the operator WHERE an import failed
// instead of a single generic "Failed to parse import" message.
export type ImportStage =
  | 'workbook-parsing'   // could not open/read the uploaded workbook/CSV bytes
  | 'mapping'            // could not determine which columns map to which field
  | 'validation'         // rows parsed but failed business validation
  | 'staging-database';  // parsed & validated but failed to persist the staged import

export class PriceImportError extends Error {
  stage: ImportStage;
  constructor(stage: ImportStage, message: string) {
    super(message);
    this.name = 'PriceImportError';
    this.stage = stage;
  }
}

export type ColumnMapping = {
  headerRowIndex: number; // 0-based row index of the header row within the grid
  jobCode: number;        // column indexes (0-based); -1 when unmapped
  description: number;
  unit: number;
  rate: number;
  category: number;
  notes: number;
};

export type ParsedLine = {
  jobCode: string;
  description: string;
  unit: string;
  ratePerUnit: number; // cents
  category: string | null;
  notes: string | null;
};

export type ErrorRow = {
  rowNumber: number; // 1-based source row number
  jobCode: string;
  description: string;
  unit: string;
  rate: string;
  reason: string;
};

export type ImportSummary = {
  totalRows: number;
  validRows: number;
  newItems: number;
  unchanged: number;
  rateIncreases: number;
  rateDecreases: number;
  duplicateJobCodes: number;
  rowsRequiringCorrection: number;
  changes: {
    jobCode: string;
    description: string;
    unit: string;
    currentRate: number | null; // cents
    uploadedRate: number;       // cents
    diff: number | null;        // cents (uploaded - current)
    kind: 'new' | 'unchanged' | 'increase' | 'decrease';
  }[];
};

// Read any supported rate sheet into a 2D string grid (first worksheet for xlsx).
export async function extractGrid(buffer: Buffer, fileType: string): Promise<string[][]> {
  const ft = (fileType || '').toLowerCase();
  if (ft.includes('csv')) {
    const text = buffer.toString('utf8');
    return parseCsv(text);
  }
  // xlsx / xls (exceljs reads xlsx; xls is best-effort)
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as any);
  } catch (e: any) {
    throw new PriceImportError('workbook-parsing', `Unable to read the workbook. It may be corrupt or not a valid .xlsx file. (${e?.message || 'unknown error'})`);
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new PriceImportError('workbook-parsing', 'The workbook contains no worksheets.');
  const grid: string[][] = [];
  // CRITICAL: read cells by explicit column index (1..colCount), NOT via
  // row.eachCell(), which SKIPS genuinely-absent cells and truncates trailing
  // empty cells. Real spreadsheets omit empty cells rather than storing empty
  // strings, so eachCell() silently shifts every column after a gap
  // (e.g. an empty Category/Notes) and corrupts the A/B/C/D/E/F mapping.
  // Preserving true Excel column positions is required by the canonical
  // mapping: A=Job Code, B=Description, C=Unit, D=Rate, E=Category, F=Notes.
  const colCount = Math.max(ws.columnCount || 0, ws.actualColumnCount || 0);
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) {
      cells.push(cellToString(row.getCell(c).value));
    }
    grid.push(cells);
  });
  return grid;
}

function cellToString(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('text' in v) return String((v as any).text);
    if ('result' in v) return String((v as any).result);
    if ('richText' in v) return (v as any).richText.map((r: any) => r.text).join('');
    return String(v);
  }
  return String(v);
}

// Minimal RFC-4180-ish CSV parser (handles quoted fields and embedded commas).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
    } else if (c === '\r') {
      // ignore; handled by \n
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const HEADER_ALIASES: Record<keyof Omit<ColumnMapping, 'headerRowIndex'>, string[]> = {
  jobCode: ['job code', 'jobcode', 'code', 'item', 'item code', 'sow', 'sow code', 'task code'],
  description: ['description', 'desc', 'item description', 'work description', 'scope'],
  unit: ['unit', 'uom', 'unit of measure', 'units'],
  rate: ['rate', 'price', 'unit price', 'prime rate', 'cost', 'amount', 'rate per unit'],
  category: ['category', 'cat', 'group', 'type'],
  notes: ['notes', 'note', 'comment', 'comments', 'remarks'],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Best-effort auto-detection of the header row and column positions.
export function autoDetectMapping(grid: string[][]): ColumnMapping | null {
  const maxScan = Math.min(grid.length, 15);
  let best: { score: number; mapping: ColumnMapping } | null = null;
  for (let r = 0; r < maxScan; r++) {
    const cells = grid[r].map(norm);
    const mapping: ColumnMapping = {
      headerRowIndex: r, jobCode: -1, description: -1, unit: -1, rate: -1, category: -1, notes: -1,
    };
    let score = 0;
    (Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]).forEach((field) => {
      const aliases = HEADER_ALIASES[field];
      for (let c = 0; c < cells.length; c++) {
        if (mapping[field] !== -1) continue;
        if (aliases.some((a) => cells[c] === a || cells[c].includes(a))) {
          mapping[field] = c; score++;
          break;
        }
      }
    });
    if (mapping.jobCode !== -1 && mapping.description !== -1 && mapping.unit !== -1 && mapping.rate !== -1) {
      if (!best || score > best.score) best = { score, mapping };
    }
  }
  return best?.mapping ?? null;
}

function parseRate(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return dollarsToCents(n);
}

// Turn a grid + mapping into validated lines and error rows.
export function buildRows(grid: string[][], mapping: ColumnMapping): { rows: ParsedLine[]; errors: ErrorRow[] } {
  const rows: ParsedLine[] = [];
  const errors: ErrorRow[] = [];
  const seen = new Map<string, number>();
  for (let r = mapping.headerRowIndex + 1; r < grid.length; r++) {
    const cells = grid[r];
    const get = (idx: number) => (idx >= 0 && idx < cells.length ? String(cells[idx] ?? '').trim() : '');
    const jobCode = get(mapping.jobCode);
    const description = get(mapping.description);
    const unit = get(mapping.unit);
    const rateRaw = get(mapping.rate);
    const category = mapping.category >= 0 ? get(mapping.category) : '';
    const notes = mapping.notes >= 0 ? get(mapping.notes) : '';
    // Skip fully-empty rows silently.
    if (!jobCode && !description && !unit && !rateRaw) continue;
    const reasons: string[] = [];
    if (!jobCode) reasons.push('Missing Job Code');
    if (!description) reasons.push('Missing Description');
    if (!unit) reasons.push('Missing Unit');
    const rate = parseRate(rateRaw);
    if (rate === null) reasons.push('Invalid or missing Rate');
    if (jobCode) {
      const prev = seen.get(jobCode.toUpperCase());
      if (prev !== undefined) reasons.push(`Duplicate Job Code (also row ${prev})`);
      seen.set(jobCode.toUpperCase(), r + 1);
    }
    if (reasons.length > 0) {
      errors.push({ rowNumber: r + 1, jobCode, description, unit, rate: rateRaw, reason: reasons.join('; ') });
      continue;
    }
    rows.push({ jobCode, description, unit, ratePerUnit: rate as number, category: category || null, notes: notes || null });
  }
  return { rows, errors };
}

export function buildSummary(
  rows: ParsedLine[],
  errors: ErrorRow[],
  currentLines: { jobCode: string; ratePerUnit: number }[],
): ImportSummary {
  const currentMap = new Map(currentLines.map((l) => [l.jobCode.toUpperCase(), l.ratePerUnit]));
  let newItems = 0, unchanged = 0, increases = 0, decreases = 0;
  const changes: ImportSummary['changes'] = [];
  for (const row of rows) {
    const cur = currentMap.get(row.jobCode.toUpperCase());
    if (cur === undefined) {
      newItems++;
      changes.push({ jobCode: row.jobCode, description: row.description, unit: row.unit, currentRate: null, uploadedRate: row.ratePerUnit, diff: null, kind: 'new' });
    } else if (cur === row.ratePerUnit) {
      unchanged++;
      changes.push({ jobCode: row.jobCode, description: row.description, unit: row.unit, currentRate: cur, uploadedRate: row.ratePerUnit, diff: 0, kind: 'unchanged' });
    } else if (row.ratePerUnit > cur) {
      increases++;
      changes.push({ jobCode: row.jobCode, description: row.description, unit: row.unit, currentRate: cur, uploadedRate: row.ratePerUnit, diff: row.ratePerUnit - cur, kind: 'increase' });
    } else {
      decreases++;
      changes.push({ jobCode: row.jobCode, description: row.description, unit: row.unit, currentRate: cur, uploadedRate: row.ratePerUnit, diff: row.ratePerUnit - cur, kind: 'decrease' });
    }
  }
  const duplicateJobCodes = errors.filter((e) => /Duplicate Job Code/.test(e.reason)).length;
  return {
    totalRows: rows.length + errors.length,
    validRows: rows.length,
    newItems,
    unchanged,
    rateIncreases: increases,
    rateDecreases: decreases,
    duplicateJobCodes,
    rowsRequiringCorrection: errors.length,
    changes,
  };
}

const TEMPLATE_COLUMNS = ['Job Code', 'Description', 'Unit', 'Rate', 'Category', 'Notes'];

export async function generateTemplateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OS1 Fiber Track Pro';
  const ws = wb.addWorksheet('Price List');
  ws.columns = [
    { header: 'Job Code', key: 'jobCode', width: 14 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Rate', key: 'rate', width: 12 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Notes', key: 'notes', width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.addRow({ jobCode: 'F1', description: 'Lash Fiber', unit: 'FT', rate: 0.61, category: 'Aerial', notes: '' });
  ws.addRow({ jobCode: 'A3', description: 'Install Down Guy', unit: 'EA', rate: 10.22, category: 'Aerial', notes: '' });
  ws.addRow({ jobCode: 'U9', description: 'Directional Bore', unit: 'FT', rate: 6.63, category: 'Underground', notes: '' });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function generateExportXlsx(
  meta: { name: string; primeName: string; version: number; effectiveDate?: Date | null },
  lines: { jobCode: string; description: string; unit: string; ratePerUnit: number; category: string | null; notes: string | null }[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OS1 Fiber Track Pro';
  const ws = wb.addWorksheet('Price List');
  ws.columns = [
    { header: 'Job Code', key: 'jobCode', width: 14 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Rate', key: 'rate', width: 12 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Notes', key: 'notes', width: 30 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  for (const l of lines) {
    ws.addRow({ jobCode: l.jobCode, description: l.description, unit: l.unit, rate: l.ratePerUnit / 100, category: l.category ?? '', notes: l.notes ?? '' });
  }
  ws.getColumn('rate').numFmt = '$0.00####';
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function generateErrorXlsx(errors: ErrorRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OS1 Fiber Track Pro';
  const ws = wb.addWorksheet('Rows Requiring Correction');
  ws.columns = [
    { header: 'Source Row', key: 'rowNumber', width: 12 },
    { header: 'Job Code', key: 'jobCode', width: 14 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Rate', key: 'rate', width: 12 },
    { header: 'Reason', key: 'reason', width: 50 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB91C1C' } };
  for (const e of errors) ws.addRow(e);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
