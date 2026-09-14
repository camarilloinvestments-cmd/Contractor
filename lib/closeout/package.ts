// Closeout package assembler.
//
// Builds the deliverable ZIP for a job's closeout: the filled fiber splice
// workbook, the branded client-safe KMZ, evidence photos/documents grouped into
// folders, a machine-readable manifest.json, and a client-safe summary PDF.
//
// CLIENT-SAFE: only as-built / delivery artifacts are included. No payouts,
// costs, commissions, margin, internal notes, or credentials.
// IMMUTABLE: each generation is persisted as a new CloseoutRevision; prior
// revisions are never overwritten.

import JSZip from 'jszip';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { generateWorkbook, type WorkbookJob } from './workbook';
import { generateKmz, type KmzJob } from './kmz';
import { CloseoutSummaryPDF, type CloseoutSummaryData } from '@/components/closeout-summary-pdf';
import { getCompanyProfile, type CompanyBranding } from '@/lib/branding';
import { getObjectBytes } from '@/lib/s3';
import type { WorkflowConfig } from './workflow-config';

export type CloseoutAsset = {
  cloudStoragePath: string;
  fileName: string;
  category: 'AS_BUILT' | 'ENCLOSURE_PHOTO' | 'OTDR' | 'POWER_METER' | 'PHOTO' | 'DOCUMENT' | 'SIGNATURE' | 'OTHER';
  contentType?: string | null;
};

export type CloseoutPackageInput = {
  job: WorkbookJob &
    KmzJob & {
      primeContractorName?: string | null;
      workflowName?: string | null;
      workflowVersion?: number | null;
    };
  cables: { label: string; fiberCount: number; placement?: string | null }[];
  assets: CloseoutAsset[];
  revision: number;
  config: WorkflowConfig;
};

export type CloseoutManifest = {
  generator: string;
  jobNumber: string;
  revision: number;
  generatedAt: string;
  workflow: { name: string | null; version: number | null };
  clientSafe: true;
  files: { name: string; category: string; bytes: number }[];
};

export type CloseoutPackageResult = {
  zip: Buffer;
  workbook: Buffer;
  kmz: Buffer;
  summaryPdf: Buffer;
  manifest: CloseoutManifest;
  zipFileName: string;
  workbookFileName: string;
  kmzFileName: string;
  summaryPdfFileName: string;
};

function applyToken(tpl: string, jobNumber: string): string {
  return tpl.replace(/\{jobNumber\}/g, jobNumber);
}

const CATEGORY_FOLDER: Record<CloseoutAsset['category'], string> = {
  AS_BUILT: 'As-Built',
  ENCLOSURE_PHOTO: 'Photos/Enclosures',
  OTDR: 'OTDR',
  POWER_METER: 'Power-Meter',
  PHOTO: 'Photos',
  DOCUMENT: 'Documents',
  SIGNATURE: 'Signatures',
  OTHER: 'Other-Evidence',
};

export async function generateCloseoutPackage(
  input: CloseoutPackageInput,
  branding?: CompanyBranding
): Promise<CloseoutPackageResult> {
  const b = branding ?? (await getCompanyProfile());
  const { job, cables, assets, revision, config } = input;
  const jobNumber = job.jobNumber;
  const generatedAt = new Date().toISOString();

  const workbookFileName = applyToken(config.fileNaming.workbook, jobNumber);
  const kmzFileName = applyToken(config.kmz.fileNameToken, jobNumber);
  const zipFileName = applyToken(config.fileNaming.zip, jobNumber);
  const summaryPdfFileName = applyToken(config.fileNaming.summaryPdf, jobNumber);

  // 1) Workbook
  const workbook = await generateWorkbook(job, config);
  // 2) KMZ (only if enabled)
  const kmz = config.kmz.enabled ? await generateKmz(job, b) : Buffer.alloc(0);

  const zip = new JSZip();
  const root = zip.folder(`JOB-${jobNumber}-CLOSEOUT`) as JSZip;

  const manifestFiles: { name: string; category: string; bytes: number }[] = [];

  root.file(workbookFileName, workbook);
  manifestFiles.push({ name: workbookFileName, category: 'Fiber Splice Workbook', bytes: workbook.length });

  if (config.kmz.enabled) {
    root.file(kmzFileName, kmz);
    manifestFiles.push({ name: kmzFileName, category: 'As-Built KMZ', bytes: kmz.length });
  }

  // 3) Evidence assets grouped by category
  for (const asset of assets) {
    const bytes = await getObjectBytes(asset.cloudStoragePath);
    if (!bytes) continue; // skip unreadable assets, keep packaging
    const folder = CATEGORY_FOLDER[asset.category] ?? 'Other-Evidence';
    root.file(`${folder}/${asset.fileName}`, bytes);
    manifestFiles.push({ name: `${folder}/${asset.fileName}`, category: asset.category, bytes: bytes.length });
  }

  // 4) Summary PDF (client-safe)
  const summaryData: CloseoutSummaryData = {
    jobNumber,
    title: job.title,
    primeContractorName: job.primeContractorName ?? null,
    workflowName: job.workflowName ?? null,
    workflowVersion: job.workflowVersion ?? null,
    address: [job.address, job.city, job.state, job.zip].filter(Boolean).join(', '),
    revision,
    generatedAt,
    splicePoints: job.splicePoints.map((sp) => ({
      label: sp.label,
      closureType: sp.closureType,
      closureId: sp.closureId,
      placement: sp.placement,
      gps: sp.latitude != null && sp.longitude != null ? `${sp.latitude.toFixed(6)}, ${sp.longitude.toFixed(6)}` : null,
    })),
    cables,
    manifestFiles: manifestFiles.map((f) => ({ name: f.name, category: f.category })),
  };
  const summaryPdf = await renderToBuffer(
    React.createElement(CloseoutSummaryPDF, { data: summaryData, branding: b as CompanyBranding }) as never
  );
  root.file(summaryPdfFileName, summaryPdf);
  manifestFiles.push({ name: summaryPdfFileName, category: 'Closeout Summary', bytes: summaryPdf.length });

  // 5) Manifest
  const manifest: CloseoutManifest = {
    generator: 'OS1 Fiber Track Pro Closeout',
    jobNumber,
    revision,
    generatedAt,
    workflow: { name: job.workflowName ?? null, version: job.workflowVersion ?? null },
    clientSafe: true,
    files: manifestFiles,
  };
  root.file('manifest.json', JSON.stringify(manifest, null, 2));

  const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  return {
    zip: zipBuf,
    workbook,
    kmz,
    summaryPdf,
    manifest,
    zipFileName,
    workbookFileName,
    kmzFileName,
    summaryPdfFileName,
  };
}
