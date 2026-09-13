import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1e40af' },
  subtitle: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 12, fontWeight: 'bold', marginBottom: 8, color: '#1e3a5f' },
  row: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: '#1e40af', backgroundColor: '#f0f4ff' },
  col1: { width: '45%', paddingRight: 8 },
  col2: { width: '15%', textAlign: 'right' },
  col3: { width: '20%', textAlign: 'right' },
  col4: { width: '20%', textAlign: 'right', fontWeight: 'bold' },
  bold: { fontWeight: 'bold' },
  totalsSection: { marginTop: 20, alignItems: 'flex-end' },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 4 },
  totalLabel: { width: 120, textAlign: 'right', paddingRight: 16 },
  totalValue: { width: 100, textAlign: 'right' },
  grandTotal: { fontSize: 14, fontWeight: 'bold', color: '#1e40af', borderTopWidth: 2, borderTopColor: '#1e40af', paddingTop: 6, marginTop: 4 },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, textAlign: 'center', color: '#9ca3af', fontSize: 8 },
  infoBlock: { marginBottom: 4 },
  infoLabel: { color: '#6b7280', fontSize: 9 },
});

function fmt(cents: number): string {
  return '$' + ((cents ?? 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function InvoicePDF({ invoice }: { invoice: any }) {
  const pc = invoice?.primeContractor;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>FiberTrack Pro</Text>
            <Text style={styles.subtitle}>Fiber Construction Services</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold' }}>INVOICE</Text>
            <Text style={{ fontSize: 12, color: '#1e40af', marginTop: 4 }}>{invoice?.invoiceNumber ?? ''}</Text>
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

        <Text style={styles.footer}>FiberTrack Pro - Thank you for your business</Text>
      </Page>
    </Document>
  );
}
