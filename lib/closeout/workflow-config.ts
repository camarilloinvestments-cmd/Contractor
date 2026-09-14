// Documentation Workflow configuration.
//
// LAYERING RULE (non-negotiable): the core data model is prime-agnostic. Each
// Prime Contractor's requirements live entirely in this JSON `config`, stored on
// a DocumentationWorkflowVersion. The generic closeout engine (workbook.ts,
// kmz.ts, package.ts) reads this config -- it contains NO hard-coded Comcast
// cell positions, photo rules, or naming rules. A new prime is added by cloning
// + editing config, never by changing application code.

export type RequiredPhoto = {
  key: string; // stable id, e.g. 'enclosure_interior'
  label: string; // shown in the field checklist
  minCount: number; // minimum photos required to satisfy
  description?: string;
};

export type RequiredField = {
  key: string;
  label: string;
  // where the value comes from on our data model, e.g. 'splicePoint.closureId'
  source?: string;
  required: boolean;
};

export type RequiredTest = {
  key: string; // 'otdr' | 'power_meter' | custom
  label: string;
  required: boolean;
  description?: string;
};

// A single cell write instruction for filling an xlsx template. `value` is a
// token resolved against the job data context at generation time (see
// workbook.ts token resolver), or a literal when wrapped in quotes.
export type CellMap = { cell: string; value: string };

// Describes how to fill one worksheet in the workbook template.
export type SheetMapping = {
  sheet: string; // worksheet name in the template
  // Header/static fields: one write each.
  header?: CellMap[];
  // Splice-point form geometry (Comcast "Splice Sheet"): the engine iterates a
  // job's splice points and, per point, fills these cells. Optional -- only the
  // splice-sheet mapping needs it.
  splicePoint?: {
    // header cells within a splice-point block, tokens resolved per point
    fields: CellMap[];
    // fiber destination column: absolute fiber position N (1..maxFibers) writes
    // its mapped destination into `${destColumn}${firstDataRow + N - 1}`.
    destColumn?: string;
    firstDataRow?: number;
    maxFibers?: number;
  };
};

export type WorkflowConfig = {
  schemaVersion: number;
  workbookTemplate: string; // repo-relative path under templates/
  requiredPhotos: RequiredPhoto[];
  requiredFields: RequiredField[];
  requiredTests: RequiredTest[];
  requiredSow: boolean; // require SOW/production codes
  requiredAsBuilt: boolean; // require as-built map
  kmz: {
    enabled: boolean;
    fileNameToken: string; // e.g. '{jobNumber}-ASBUILT.kmz'
    includeSplicePoints: boolean;
    includeJobSite: boolean;
  };
  approvalChecklist: { key: string; label: string }[];
  fileNaming: {
    workbook: string; // token template, e.g. '{jobNumber}-FIBER-SPLICE-WORKBOOK.xlsx'
    zip: string;
    summaryPdf: string;
  };
  invoiceGating: { requireCloseoutBeforeInvoice: boolean };
  // Template cell mapping (prime-specific, data-driven). Consumed by workbook.ts.
  templateMapping: SheetMapping[];
};

// ---------------------------------------------------------------------------
// Comcast "Fiber Construction Closeout" default config.
// Cell coordinates were mapped from the supplied
// templates/comcast/blank-fiber-splice-workbook.xlsx.
// ---------------------------------------------------------------------------
export const COMCAST_CLOSEOUT_CONFIG: WorkflowConfig = {
  schemaVersion: 1,
  workbookTemplate: 'templates/comcast/blank-fiber-splice-workbook.xlsx',
  requiredPhotos: [
    {
      key: 'enclosure_interior',
      label: 'Enclosure interior photos',
      minCount: 1,
      description:
        'Photos of the interior of the splice enclosures showing tray management and that fiber cables are secure and grounded.',
    },
    {
      key: 'as_built_map',
      label: 'As-built / production map',
      minCount: 1,
      description:
        'Final as-built map with invoiced labor codes and footages (or production map for job types without an as-built).',
    },
  ],
  requiredFields: [
    { key: 'closureId', label: 'Closure ID Number', source: 'splicePoint.closureId', required: true },
    { key: 'closureType', label: 'Closure Type', source: 'splicePoint.closureType', required: true },
    { key: 'splicer', label: 'Splicer / LCP', source: 'splicePoint.splicer', required: true },
    { key: 'gps', label: 'GPS Coordinates', source: 'splicePoint.gps', required: true },
  ],
  requiredTests: [
    { key: 'otdr', label: 'OTDR Report', required: true, description: 'OTDR traces / findings for continuity audit.' },
    { key: 'power_meter', label: 'Power Meter Readings', required: false },
  ],
  requiredSow: true,
  requiredAsBuilt: true,
  kmz: {
    enabled: true,
    fileNameToken: '{jobNumber}-ASBUILT.kmz',
    includeSplicePoints: true,
    includeJobSite: true,
  },
  approvalChecklist: [
    { key: 'workbook_complete', label: 'Fiber splice workbook complete for all closures' },
    { key: 'enclosure_photos', label: 'Enclosure interior photos attached' },
    { key: 'as_built', label: 'As-built / production map attached' },
    { key: 'otdr', label: 'OTDR report attached' },
    { key: 'gps_verified', label: 'GPS coordinates verified for all splice points' },
  ],
  fileNaming: {
    workbook: '{jobNumber}-FIBER-SPLICE-WORKBOOK.xlsx',
    zip: 'JOB-{jobNumber}-CLOSEOUT.zip',
    summaryPdf: '{jobNumber}-CLOSEOUT-SUMMARY.pdf',
  },
  invoiceGating: { requireCloseoutBeforeInvoice: true },
  templateMapping: [
    {
      sheet: 'Splice Sheet',
      splicePoint: {
        fields: [
          { cell: 'C1', value: '{splicePoint.label}' },
          { cell: 'H1', value: '{splicePoint.address}' },
          { cell: 'C2', value: '{splicePoint.closureType}' },
          { cell: 'H2', value: '{splicePoint.poleNumber}' },
          { cell: 'B3', value: '{splicePoint.closureId}' },
          { cell: 'R3', value: '{splicePoint.gps}' },
          { cell: 'C4', value: '{splicePoint.trayCount}' },
          { cell: 'L4', value: '{splicePoint.hexMap}' },
          { cell: 'M2', value: '{splicePoint.splicer}' },
        ],
        destColumn: 'AN',
        firstDataRow: 12,
        maxFibers: 288,
      },
    },
  ],
};

// Runtime guard used by API routes / generators to coerce stored JSON to the
// config type with sane fallbacks (older versions may lack newer keys).
export function normalizeConfig(raw: unknown): WorkflowConfig {
  const base = COMCAST_CLOSEOUT_CONFIG;
  if (!raw || typeof raw !== 'object') return base;
  const c = raw as Partial<WorkflowConfig>;
  return {
    schemaVersion: c.schemaVersion ?? base.schemaVersion,
    workbookTemplate: c.workbookTemplate ?? base.workbookTemplate,
    requiredPhotos: c.requiredPhotos ?? base.requiredPhotos,
    requiredFields: c.requiredFields ?? base.requiredFields,
    requiredTests: c.requiredTests ?? base.requiredTests,
    requiredSow: c.requiredSow ?? base.requiredSow,
    requiredAsBuilt: c.requiredAsBuilt ?? base.requiredAsBuilt,
    kmz: c.kmz ?? base.kmz,
    approvalChecklist: c.approvalChecklist ?? base.approvalChecklist,
    fileNaming: c.fileNaming ?? base.fileNaming,
    invoiceGating: c.invoiceGating ?? base.invoiceGating,
    templateMapping: c.templateMapping ?? base.templateMapping,
  };
}
