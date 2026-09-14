// Immutable document snapshots + revision/send history helpers (requirement F).
//
// A snapshot is the exact customer-facing data of a document at the moment it is
// (re)sent or converted. It is stored as a DocumentRevision.snapshot JSON blob
// and NEVER mutated afterwards. Any change to a document that has already been
// sent produces a NEW revision. Send/resend events are recorded as append-only
// DocumentSend rows that reference the exact revision — prior send evidence is
// never overwritten.
//
// Snapshots intentionally contain ONLY customer-facing fields (redaction by
// construction, requirement H): no subcontractor payout, internal cost,
// commission, or margin values.

import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type DocumentType = 'ESTIMATE' | 'QUOTE' | 'INVOICE';

type Tx = Prisma.TransactionClient | PrismaClient;

export type LineSnapshot = {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number; // cents, customer-facing
  amount: number; // cents
  jobCode: string | null;
  priceBookId: string | null;
  priceBookVersionId: string | null;
};

export type DocumentSnapshot = {
  documentType: DocumentType;
  documentNumber: string;
  title: string | null;
  status: string;
  issueDate: string | null;
  expirationDate: string | null;
  primeContractor: {
    companyName: string | null;
    contactName: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
  project: { projectName: string | null; projectCode: string | null } | null;
  items: LineSnapshot[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  terms: string | null;
  exclusions: string | null;
  assumptions: string | null;
  notes: string | null; // internal note text is deliberately NOT carried here
  priceBookId: string | null;
  priceBookVersionId: string | null;
};

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toISOString();
}

function mapLines(items: any[]): LineSnapshot[] {
  return (items ?? []).map((it) => ({
    description: it.description ?? '',
    quantity: it.quantity ?? 0,
    unit: it.unit ?? null,
    unitPrice: it.unitPrice ?? 0,
    amount: it.amount ?? 0,
    jobCode: it.jobCode ?? null,
    priceBookId: it.priceBookId ?? null,
    priceBookVersionId: it.priceBookVersionId ?? null,
  }));
}

function mapPrime(pc: any) {
  if (!pc) return null;
  return {
    companyName: pc.companyName ?? null,
    contactName: pc.contactName ?? null,
    email: pc.email ?? null,
    address: pc.address ?? null,
    city: pc.city ?? null,
    state: pc.state ?? null,
    zip: pc.zip ?? null,
  };
}

function mapProject(p: any) {
  if (!p) return null;
  return { projectName: p.projectName ?? null, projectCode: p.projectCode ?? null };
}

/** Build an immutable snapshot from a fully-included Estimate. */
export function buildEstimateSnapshot(estimate: any): DocumentSnapshot {
  return {
    documentType: 'ESTIMATE',
    documentNumber: estimate.estimateNumber,
    title: estimate.title ?? null,
    status: estimate.status,
    issueDate: iso(estimate.issueDate),
    expirationDate: iso(estimate.expirationDate),
    primeContractor: mapPrime(estimate.primeContractor),
    project: mapProject(estimate.project),
    items: mapLines(estimate.items),
    subtotal: estimate.subtotal ?? 0,
    taxRate: estimate.taxRate ?? 0,
    taxAmount: estimate.taxAmount ?? 0,
    total: estimate.total ?? 0,
    terms: null,
    exclusions: estimate.exclusions ?? null,
    assumptions: estimate.assumptions ?? null,
    notes: null,
    priceBookId: null,
    priceBookVersionId: null,
  };
}

/** Build an immutable snapshot from a fully-included Quote. */
export function buildQuoteSnapshot(quote: any): DocumentSnapshot {
  return {
    documentType: 'QUOTE',
    documentNumber: quote.quoteNumber,
    title: quote.title ?? null,
    status: quote.status,
    issueDate: iso(quote.issueDate),
    expirationDate: iso(quote.expirationDate),
    primeContractor: mapPrime(quote.primeContractor),
    project: mapProject(quote.project),
    items: mapLines(quote.items),
    subtotal: quote.subtotal ?? 0,
    taxRate: quote.taxRate ?? 0,
    taxAmount: quote.taxAmount ?? 0,
    total: quote.total ?? 0,
    terms: quote.terms ?? null,
    exclusions: quote.exclusions ?? null,
    assumptions: null,
    notes: null,
    priceBookId: quote.priceBookId ?? null,
    priceBookVersionId: quote.priceBookVersionId ?? null,
  };
}

/** Build an immutable snapshot from a fully-included Invoice. */
export function buildInvoiceSnapshot(invoice: any): DocumentSnapshot {
  return {
    documentType: 'INVOICE',
    documentNumber: invoice.invoiceNumber,
    title: null,
    status: invoice.status,
    issueDate: iso(invoice.createdAt),
    expirationDate: iso(invoice.dueDate),
    primeContractor: mapPrime(invoice.primeContractor),
    project: null,
    items: mapLines(invoice.items),
    subtotal: invoice.subtotal ?? 0,
    taxRate: invoice.taxRate ?? 0,
    taxAmount: invoice.taxAmount ?? 0,
    total: invoice.total ?? 0,
    terms: null,
    exclusions: null,
    assumptions: null,
    notes: invoice.notes ?? null, // invoice notes ARE customer-facing on the PDF
    priceBookId: null,
    priceBookVersionId: null,
  };
}

/**
 * Create (or return existing) the next revision for a document, storing the
 * given snapshot. Revision numbers are monotonic per (documentType, documentId).
 * Returns the created DocumentRevision.
 */
export async function createRevision(
  documentType: DocumentType,
  documentId: string,
  snapshot: DocumentSnapshot,
  createdById?: string | null,
  client: Tx = prisma
) {
  const last = await client.documentRevision.findFirst({
    where: { documentType, documentId },
    orderBy: { revision: 'desc' },
    select: { revision: true },
  });
  const revision = (last?.revision ?? 0) + 1;
  return client.documentRevision.create({
    data: {
      documentType,
      documentId,
      revision,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      createdById: createdById ?? null,
    },
  });
}

/** Fetch the latest revision for a document (or null). */
export async function latestRevision(
  documentType: DocumentType,
  documentId: string,
  client: Tx = prisma
) {
  return client.documentRevision.findFirst({
    where: { documentType, documentId },
    orderBy: { revision: 'desc' },
  });
}

export type RecordSendInput = {
  documentType: DocumentType;
  documentId: string;
  revisionId?: string | null;
  toAddress: string;
  ccAddress?: string | null;
  bccAddress?: string | null;
  subject?: string | null;
  sentById?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  success: boolean;
  failureCategory?: string | null;
  failureMessage?: string | null;
};

/**
 * Append a send/resend evidence row. NEVER overwrites prior sends — each call
 * inserts a new immutable DocumentSend record (requirement F).
 */
export async function recordSend(input: RecordSendInput, client: Tx = prisma) {
  return client.documentSend.create({
    data: {
      documentType: input.documentType,
      documentId: input.documentId,
      revisionId: input.revisionId ?? null,
      toAddress: input.toAddress,
      ccAddress: input.ccAddress ?? null,
      bccAddress: input.bccAddress ?? null,
      subject: input.subject ?? null,
      sentById: input.sentById ?? null,
      provider: input.provider ?? null,
      providerMessageId: input.providerMessageId ?? null,
      success: input.success,
      failureCategory: input.failureCategory ?? null,
      failureMessage: input.failureMessage ?? null,
    },
  });
}
