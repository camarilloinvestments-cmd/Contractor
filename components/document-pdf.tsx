import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

// Customer-facing commercial document PDF (Estimate / Quote). Renders ONLY
// customer-facing values — no subcontractor payout, internal cost, commission,
// or margin (redaction by construction, requirement H). Branding is pulled from
// CompanyProfile (requirement I).

type Branding = {
  companyName?: string | null;
  tagline?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  invoiceFooter?: string | null;
};

const DEFAULTS = {
  companyName: 'OS1 Fiber Track Pro',
  tagline: 'Fiber Construction Services',
  primaryColor: '#1e40af',
  accentColor: '#0891b2',
  footer: 'Thank you for your business',
};

function buildStyles(primary: string) {
  return StyleSheet.create({
    page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica' },
    header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30 },
    logo: { width: 150, height: 60, objectFit: 'contain', marginBottom: 8 },
    title: { fontSize: 24, fontWeight: 'bold', color: primary },
    subtitle: { fontSize: 12, color: '#6b7280', marginTop: 4 },
    companyMeta: { fontSize: 9, color: '#6b7280', marginTop: 2 },
    section: { marginBottom: 20 },
    sectionTitle: { fontSize: 12, fontWeight: 'bold', marginBottom: 8, color: '#1e3a5f' },
    row: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
    headerRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: primary, backgroundColor: '#f0f4ff' },
    col1: { width: '45%', paddingRight: 8 },
    col2: { width: '15%', textAlign: 'right' },
    col3: { width: '20%', textAlign: 'right' },
    col4: { width: '20%', textAlign: 'right', fontWeight: 'bold' },
    bold: { fontWeight: 'bold' },
    metaLabel: { color: '#6b7280', marginTop: 4 },
    totalsSection: { marginTop: 20, alignItems: 'flex-end' },
    totalRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 4 },
    totalLabel: { width: 120, textAlign: 'right', paddingRight: 16 },
    totalValue: { width: 100, textAlign: 'right' },
    grandTotal: { fontSize: 14, fontWeight: 'bold', color: primary, borderTopWidth: 2, borderTopColor: primary, paddingTop: 6, marginTop: 4 },
    para: { marginTop: 4, lineHeight: 1.4 },
    footer: { position: 'absolute', bottom: 30, left: 40, right: 40, textAlign: 'center', color: '#9ca3af', fontSize: 8 },
  });
}

function fmt(cents: number): string {
  return '$' + ((cents ?? 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtDate(d: any): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC' });
}

export type CommercialDocKind = 'ESTIMATE' | 'QUOTE';

const LABELS: Record<CommercialDocKind, { title: string; number: string; expLabel: string }> = {
  ESTIMATE: { title: 'ESTIMATE', number: 'Estimate #', expLabel: 'Valid Until' },
  QUOTE: { title: 'QUOTE', number: 'Quote #', expLabel: 'Valid Until' },
};

export function CommercialDocumentPDF({
  doc,
  branding,
  kind,
}: {
  doc: any;
  branding?: Branding;
  kind: CommercialDocKind;
}) {
  const b = branding ?? {};
  const labels = LABELS[kind];
  const companyName = b.companyName || DEFAULTS.companyName;
  const tagline = b.tagline || DEFAULTS.tagline;
  const primary = b.primaryColor || DEFAULTS.primaryColor;
  const footerText = b.invoiceFooter
    ? `${companyName} — ${b.invoiceFooter}`
    : `${companyName} — ${DEFAULTS.footer}`;
  const styles = buildStyles(primary);
  const pc = doc?.primeContractor;
  const docNumber = kind === 'ESTIMATE' ? doc?.estimateNumber : doc?.quoteNumber;

  const companyAddress = [b.address, [b.city, b.state, b.zip].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join(', ');

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            {b.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={b.logoUrl} style={styles.logo} />
            ) : null}
            <Text style={styles.title}>{companyName}</Text>
            <Text style={styles.subtitle}>{tagline}</Text>
            {companyAddress ? <Text style={styles.companyMeta}>{companyAddress}</Text> : null}
            {(b.phone || b.email) ? (
              <Text style={styles.companyMeta}>{[b.phone, b.email].filter(Boolean).join('  •  ')}</Text>
            ) : null}
            {b.website ? <Text style={styles.companyMeta}>{b.website}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold' }}>{labels.title}</Text>
            <Text style={{ fontSize: 12, color: primary, marginTop: 4 }}>{docNumber ?? ''}</Text>
            <Text style={styles.metaLabel}>Date: {fmtDate(doc?.issueDate)}</Text>
            {doc?.expirationDate ? (
              <Text style={styles.metaLabel}>{labels.expLabel}: {fmtDate(doc.expirationDate)}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prepared For:</Text>
          <Text style={styles.bold}>{pc?.companyName ?? ''}</Text>
          {pc?.contactName ? <Text>{pc.contactName}</Text> : null}
          {pc?.address ? <Text>{pc.address}</Text> : null}
          {(pc?.city || pc?.state || pc?.zip) ? (
            <Text>{[pc?.city, pc?.state, pc?.zip].filter(Boolean).join(', ')}</Text>
          ) : null}
          {pc?.email ? <Text>{pc.email}</Text> : null}
          {doc?.project ? (
            <Text style={{ marginTop: 6 }}>Project: {doc.project.projectName ?? doc.project.projectCode ?? ''}</Text>
          ) : null}
        </View>

        {doc?.title ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Scope:</Text>
            <Text>{doc.title}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.headerRow}>
            <Text style={[styles.col1, styles.bold]}>Description</Text>
            <Text style={[styles.col2, styles.bold]}>Qty</Text>
            <Text style={[styles.col3, styles.bold]}>Unit Price</Text>
            <Text style={[styles.col4, styles.bold]}>Amount</Text>
          </View>
          {(doc?.items ?? []).map((item: any, idx: number) => (
            <View key={idx} style={styles.row}>
              <Text style={styles.col1}>{item?.description ?? ''}</Text>
              <Text style={styles.col2}>{item?.quantity ?? 0}{item?.unit ? ` ${item.unit}` : ''}</Text>
              <Text style={styles.col3}>{fmt(item?.unitPrice ?? 0)}</Text>
              <Text style={styles.col4}>{fmt(item?.amount ?? 0)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal:</Text>
            <Text style={styles.totalValue}>{fmt(doc?.subtotal ?? 0)}</Text>
          </View>
          {(doc?.taxRate ?? 0) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax ({doc?.taxRate ?? 0}%):</Text>
              <Text style={styles.totalValue}>{fmt(doc?.taxAmount ?? 0)}</Text>
            </View>
          )}
          <View style={[styles.totalRow, styles.grandTotal]}>
            <Text style={styles.totalLabel}>Total:</Text>
            <Text style={styles.totalValue}>{fmt(doc?.total ?? 0)}</Text>
          </View>
        </View>

        {doc?.assumptions ? (
          <View style={[styles.section, { marginTop: 24 }]}>
            <Text style={styles.sectionTitle}>Assumptions:</Text>
            <Text style={styles.para}>{doc.assumptions}</Text>
          </View>
        ) : null}

        {doc?.exclusions ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Exclusions:</Text>
            <Text style={styles.para}>{doc.exclusions}</Text>
          </View>
        ) : null}

        {doc?.terms ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Terms:</Text>
            <Text style={styles.para}>{doc.terms}</Text>
          </View>
        ) : null}

        <Text style={styles.footer}>{footerText}</Text>
      </Page>
    </Document>
  );
}

export function EstimatePDF({ estimate, branding }: { estimate: any; branding?: Branding }) {
  return <CommercialDocumentPDF doc={estimate} branding={branding} kind="ESTIMATE" />;
}

export function QuotePDF({ quote, branding }: { quote: any; branding?: Branding }) {
  return <CommercialDocumentPDF doc={quote} branding={branding} kind="QUOTE" />;
}

// Customer-facing Statement of Account PDF. Same branded header/footer as the
// commercial documents. Renders ONLY customer-facing money (balances, invoices,
// payments/credits, aging) — no payout/cost/margin/commission values.
export function StatementPDF({ statement, branding }: { statement: any; branding?: Branding }) {
  const b = branding ?? {};
  const companyName = b.companyName || DEFAULTS.companyName;
  const tagline = b.tagline || DEFAULTS.tagline;
  const primary = b.primaryColor || DEFAULTS.primaryColor;
  const footerText = b.invoiceFooter
    ? `${companyName} — ${b.invoiceFooter}`
    : `${companyName} — ${DEFAULTS.footer}`;
  const styles = buildStyles(primary);
  const pc = statement?.primeContractor;
  const lines = statement?.lines ?? [];

  const companyAddress = [b.address, [b.city, b.state, b.zip].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join(', ');

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            {b.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={b.logoUrl} style={styles.logo} />
            ) : null}
            <Text style={styles.title}>{companyName}</Text>
            <Text style={styles.subtitle}>{tagline}</Text>
            {companyAddress ? <Text style={styles.companyMeta}>{companyAddress}</Text> : null}
            {(b.phone || b.email) ? (
              <Text style={styles.companyMeta}>{[b.phone, b.email].filter(Boolean).join('  •  ')}</Text>
            ) : null}
            {b.website ? <Text style={styles.companyMeta}>{b.website}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold' }}>STATEMENT</Text>
            <Text style={{ fontSize: 12, color: primary, marginTop: 4 }}>{statement?.statementNumber ?? ''}</Text>
            <Text style={styles.metaLabel}>Date: {fmtDate(statement?.statementDate)}</Text>
            <Text style={styles.metaLabel}>
              Period: {fmtDate(statement?.periodStart)} – {fmtDate(statement?.periodEnd)}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Statement For:</Text>
          <Text style={styles.bold}>{pc?.companyName ?? ''}</Text>
          {pc?.contactName ? <Text>{pc.contactName}</Text> : null}
          {pc?.address ? <Text>{pc.address}</Text> : null}
          {(pc?.city || pc?.state || pc?.zip) ? (
            <Text>{[pc?.city, pc?.state, pc?.zip].filter(Boolean).join(', ')}</Text>
          ) : null}
          {pc?.email ? <Text>{pc.email}</Text> : null}
          {statement?.project ? (
            <Text style={{ marginTop: 6 }}>
              Project: {statement.project.projectName ?? statement.project.projectCode ?? ''}
            </Text>
          ) : null}
        </View>

        {/* Account activity ledger */}
        <View style={styles.section}>
          <View style={styles.headerRow}>
            <Text style={[styles.col1, styles.bold]}>Date / Description</Text>
            <Text style={[styles.col2, styles.bold]}>Charges</Text>
            <Text style={[styles.col3, styles.bold]}>Credits</Text>
            <Text style={[styles.col4, styles.bold]}>Balance</Text>
          </View>
          {lines.map((l: any, idx: number) => (
            <View key={idx} style={styles.row}>
              <Text style={styles.col1}>
                {l?.date ? `${fmtDate(l.date)} — ` : ''}{l?.description ?? ''}
              </Text>
              <Text style={styles.col2}>{(l?.charges ?? 0) > 0 ? fmt(l.charges) : ''}</Text>
              <Text style={styles.col3}>{(l?.credits ?? 0) > 0 ? fmt(l.credits) : ''}</Text>
              <Text style={styles.col4}>{fmt(l?.balance ?? 0)}</Text>
            </View>
          ))}
        </View>

        {/* Period summary */}
        <View style={styles.totalsSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Opening Balance:</Text>
            <Text style={styles.totalValue}>{fmt(statement?.openingBalance ?? 0)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Invoiced:</Text>
            <Text style={styles.totalValue}>{fmt(statement?.invoicedAmount ?? 0)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Payments/Credits:</Text>
            <Text style={styles.totalValue}>-{fmt(statement?.paymentsAmount ?? 0)}</Text>
          </View>
          <View style={[styles.totalRow, styles.grandTotal]}>
            <Text style={styles.totalLabel}>Balance Due:</Text>
            <Text style={styles.totalValue}>{fmt(statement?.endingBalance ?? 0)}</Text>
          </View>
        </View>

        {/* Aging summary */}
        <View style={[styles.section, { marginTop: 24 }]}>
          <Text style={styles.sectionTitle}>Aging Summary</Text>
          <View style={styles.headerRow}>
            <Text style={[{ width: '20%' }, styles.bold]}>Current</Text>
            <Text style={[{ width: '20%' }, styles.bold]}>1–30</Text>
            <Text style={[{ width: '20%' }, styles.bold]}>31–60</Text>
            <Text style={[{ width: '20%' }, styles.bold]}>61–90</Text>
            <Text style={[{ width: '20%' }, styles.bold]}>91+</Text>
          </View>
          <View style={styles.row}>
            <Text style={{ width: '20%' }}>{fmt(statement?.agingCurrent ?? 0)}</Text>
            <Text style={{ width: '20%' }}>{fmt(statement?.aging1To30 ?? 0)}</Text>
            <Text style={{ width: '20%' }}>{fmt(statement?.aging31To60 ?? 0)}</Text>
            <Text style={{ width: '20%' }}>{fmt(statement?.aging61To90 ?? 0)}</Text>
            <Text style={{ width: '20%' }}>{fmt(statement?.aging91Plus ?? 0)}</Text>
          </View>
        </View>

        {statement?.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes:</Text>
            <Text style={styles.para}>{statement.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer}>{footerText}</Text>
      </Page>
    </Document>
  );
}
