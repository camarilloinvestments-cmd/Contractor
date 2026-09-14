// Fiber splice workbook generator.
//
// TEMPLATE FIDELITY: we load the prime's supplied .xlsx template, fill ONLY the
// data cells described by the workflow config's templateMapping, and save. All
// formatting, merged cells, instructions and color-code reference tables are
// preserved exactly, so the output opens in Excel with no repair prompt.
//
// The engine is prime-agnostic: it knows nothing about Comcast. It reads the
// mapping + tokens from the workflow config (workflow-config.ts).

import ExcelJS from 'exceljs';
import path from 'path';
import { promises as fs } from 'fs';
import type { WorkflowConfig, SheetMapping, CellMap } from './workflow-config';

// ---- Data shapes the generator consumes (subset of Prisma models) ----------
export type WorkbookSplicePoint = {
  label: string;
  closureType?: string | null;
  closureId?: string | null;
  address?: string | null;
  poleNumber?: string | null;
  placement?: string | null; // AERIAL | UNDERGROUND | UNKNOWN
  trayCount?: number | null;
  hexMap?: string | null;
  splicer?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  // per-fiber destinations keyed by absolute fiber position (1-based)
  fiberDestinations?: { position: number; destination: string }[];
};

export type WorkbookJob = {
  jobNumber: string;
  title?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  splicePoints: WorkbookSplicePoint[];
};

// Resolve a `{a.b}` token (or literal text) against a flat context map.
function resolveToken(value: string, ctx: Record<string, unknown>): string {
  if (value == null) return '';
  return value.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const v = ctx[key.trim()];
    return v === undefined || v === null ? '' : String(v);
  });
}

function gpsString(lat?: number | null, lng?: number | null): string {
  if (lat == null || lng == null) return '';
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

// Build the token context for one splice point.
function splicePointCtx(sp: WorkbookSplicePoint): Record<string, unknown> {
  return {
    'splicePoint.label': sp.label ?? '',
    'splicePoint.closureType': sp.closureType ?? '',
    'splicePoint.closureId': sp.closureId ?? '',
    'splicePoint.address': sp.address ?? '',
    'splicePoint.poleNumber': sp.poleNumber ?? '',
    'splicePoint.trayCount': sp.trayCount ?? '',
    'splicePoint.hexMap': sp.hexMap ?? '',
    'splicePoint.splicer': sp.splicer ?? '',
    'splicePoint.gps': gpsString(sp.latitude, sp.longitude),
    'splicePoint.placement': sp.placement ?? '',
  };
}

// Deep-copy a worksheet (values + styles + merges + column widths) so a job
// with multiple splice points gets one Splice Sheet per closure.
function cloneWorksheet(wb: ExcelJS.Workbook, source: ExcelJS.Worksheet, newName: string): ExcelJS.Worksheet {
  const target = wb.addWorksheet(newName, {
    properties: { ...source.properties },
    pageSetup: { ...source.pageSetup },
    views: source.views ? JSON.parse(JSON.stringify(source.views)) : undefined,
  });
  // Column widths / styles
  source.columns?.forEach((col, i) => {
    if (col && col.width) target.getColumn(i + 1).width = col.width;
  });
  // Merge cells FIRST (on the empty target) so that copying values afterwards
  // only writes the top-left cell of each merge -- avoids exceljs throwing
  // "would lose data" when sub-cells carry placeholder values.
  const merges = (source.model as unknown as { merges?: string[] }).merges;
  if (Array.isArray(merges)) {
    for (const range of merges) {
      try {
        target.mergeCells(range);
      } catch {
        /* ignore overlapping/duplicate merges */
      }
    }
  }
  // Copy every cell value + style.
  source.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const trow = target.getRow(rowNumber);
    trow.height = row.height;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const tcell = trow.getCell(colNumber);
      try {
        tcell.value = cell.value;
      } catch {
        /* merged sub-cell -- value lives on the master, ignore */
      }
      if (cell.style) tcell.style = JSON.parse(JSON.stringify(cell.style));
    });
    trow.commit();
  });
  return target;
}

function applyFields(ws: ExcelJS.Worksheet, fields: CellMap[], ctx: Record<string, unknown>) {
  for (const f of fields) {
    const text = resolveToken(f.value, ctx);
    if (text !== '') ws.getCell(f.cell).value = text;
  }
}

// Fill fiber destinations down a column starting at firstDataRow.
function applyFiberDestinations(
  ws: ExcelJS.Worksheet,
  sp: WorkbookSplicePoint,
  destColumn: string,
  firstDataRow: number,
  maxFibers: number
) {
  if (!sp.fiberDestinations?.length) return;
  for (const fd of sp.fiberDestinations) {
    if (fd.position < 1 || fd.position > maxFibers) continue;
    const rowNum = firstDataRow + fd.position - 1;
    ws.getCell(`${destColumn}${rowNum}`).value = fd.destination;
  }
}

// Locate the template on disk. In a self-hosted deploy the repo tree is present,
// so we resolve relative to the process working directory.
async function readTemplate(relPath: string): Promise<Buffer> {
  const candidates = [
    path.join(process.cwd(), relPath),
    path.join(process.cwd(), '..', relPath),
  ];
  for (const p of candidates) {
    try {
      return await fs.readFile(p);
    } catch {
      /* try next */
    }
  }
  throw new Error(`Workbook template not found: ${relPath}`);
}

// Generate the filled workbook as a Buffer.
export async function generateWorkbook(job: WorkbookJob, config: WorkflowConfig): Promise<Buffer> {
  const tplBytes = await readTemplate(config.workbookTemplate);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(tplBytes as unknown as ExcelJS.Buffer);

  const spMapping: SheetMapping | undefined = config.templateMapping.find((m) => m.splicePoint);

  if (spMapping?.splicePoint && job.splicePoints.length > 0) {
    const templateSheet = wb.getWorksheet(spMapping.sheet);
    if (templateSheet) {
      const { fields, destColumn, firstDataRow, maxFibers } = spMapping.splicePoint;
      job.splicePoints.forEach((sp, idx) => {
        let ws: ExcelJS.Worksheet;
        if (idx === 0) {
          ws = templateSheet;
        } else {
          // Clone the pristine template sheet for each additional splice point.
          const name = `Splice Sheet ${idx + 1}`.slice(0, 31);
          ws = cloneWorksheet(wb, templateSheet, name);
        }
        applyFields(ws, fields, splicePointCtx(sp));
        if (destColumn && firstDataRow && maxFibers) {
          applyFiberDestinations(ws, sp, destColumn, firstDataRow, maxFibers);
        }
      });
    }
  }

  // Apply any pure-header sheet mappings (non-splice-point).
  const jobCtx: Record<string, unknown> = {
    'job.jobNumber': job.jobNumber,
    'job.title': job.title ?? '',
    'job.address': [job.address, job.city, job.state, job.zip].filter(Boolean).join(', '),
  };
  for (const m of config.templateMapping) {
    if (m.splicePoint || !m.header) continue;
    const ws = wb.getWorksheet(m.sheet);
    if (ws) applyFields(ws, m.header, jobCtx);
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
