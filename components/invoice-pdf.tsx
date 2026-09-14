import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

// Branding shape passed from the server (CompanyProfile). Optional so the
// component still renders with sensible defaults if branding is unavailable.
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

const DEFAULTS: { companyName: string; tagline: string; primaryColor: string; accentColor: string; invoiceFooter: string } = {
  companyName: 'OS1 Fiber Track Pro',
  tagline: 'Fiber Construction Services',
  primaryColor: '#1e40af',
  accentColor: '#0891b2',
  invoiceFooter: 'Thank you for your business',
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
    totalsSection: { marginTop: 20, alignItems: 'flex-end' },
    totalRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 4 },
    totalLabel: { width: 120, textAlign: 'right', paddingRight: 16 },
    totalValue: { width: 100, textAlign: 'right' },
    grandTotal: { fontSize: 14, fontWeight: 'bold', color: primary, borderTopWidth: 2, borderTopColor: primary, paddingTop: 6, marginTop: 4 },
    footer: { position: 'absolute', bottom: 30, left: 40, right: 40, textAlign: 'center', color: '#9ca3af', fontSize: 8 },
  });
}

function fmt(cents: number): string {
  return '$' + ((cents ?? 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function InvoicePDF({ invoice, branding }: { invoice: any; branding?: Branding }) {
  const b = branding ?? {};
  const companyName = b.companyName || DEFAULTS.companyName;
  const tagline = b.tagline || DEFAULTS.tagline;
  const primary = b.primaryColor || DEFAULTS.primaryColor;
  const footerText = b.invoiceFooter
    ? `${companyName} — ${b.invoiceFooter}`
    : `${companyName} — ${DEFAULTS.invoiceFooter}`;
  const styles = buildStyles(primary);
  const pc = invoice?.primeContractor;

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
            <Text style={{ fontSize: 18, fontWeight: 'bold' }}>INVOICE</Text>
            <Text style={{ fontSize: 12, color: primary, marginTop: 4 }}>{invoice?.invoiceNumber ?? ''}</Text>
            <Text style={{ color: '#6b7280', marginTop: 4 }}>Date: {new Date(invoice?.createdAt).toLocaleDateString('en-US', { timeZone: 'UTC' })}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bill To:</Text>
          <Text style={styles.bold}>{pc?.companyName ?? ''}</Text>
          {pc?.contactName ? <Text>{pc.contactName}</Text> : null}
          {pc?.address ? <Text>{pc.address}</Text> : null}
          {(pc?.city || pc?.state || pc?.zip) ? (
            <Text>{[pc?.city, pc?.state, pc?.zip].filter(Boolean).join(', ')}</Text>
          ) : null}
          {pc?.email ? <Text>{pc.email}</Text> : null}
        </View>

        <View style={styles.section}>
          <View style={styles.headerRow}>
            <Text style={[styles.col1, styles.bold]}>Description</Text>
            <Text style={[styles.col2, styles.bold]}>Qty</Text>
            <Text style={[styles.col3, styles.bold]}>Unit Price</Text>
            <Text style={[styles.col4, styles.bold]}>Amount</Text>
          </View>
          {(invoice?.items ?? []).map((item: any, idx: number) => (
            <View key={idx} style={styles.row}>
              <Text style={styles.col1}>{item?.description ?? ''}</Text>
              <Text style={styles.col2}>{item?.quantity ?? 0}</Text>
              <Text style={styles.col3}>{fmt(item?.unitPrice ?? 0)}</Text>
              <Text style={styles.col4}>{fmt(item?.amount ?? 0)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal:</Text>
            <Text style={styles.totalValue}>{fmt(invoice?.subtotal ?? 0)}</Text>
          </View>
          {(invoice?.taxRate ?? 0) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax ({invoice?.taxRate ?? 0}%):</Text>
              <Text style={styles.totalValue}>{fmt(invoice?.taxAmount ?? 0)}</Text>
            </View>
          )}
          <View style={[styles.totalRow, styles.grandTotal]}>
            <Text style={styles.totalLabel}>Total:</Text>
            <Text style={styles.totalValue}>{fmt(invoice?.total ?? 0)}</Text>
          </View>
        </View>

        {invoice?.notes ? (
          <View style={[styles.section, { marginTop: 30 }]}>
            <Text style={styles.sectionTitle}>Notes:</Text>
            <Text>{invoice.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer}>{footerText}</Text>
      </Page>
    </Document>
  );
}
