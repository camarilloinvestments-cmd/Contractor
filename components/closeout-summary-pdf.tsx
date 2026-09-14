import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

// CLIENT-SAFE closeout summary. Shows job identification, splice-point inventory,
// fiber counts and the document manifest ONLY. Never renders payouts, costs,
// commissions, margin, internal notes, or credentials.

type Branding = {
  companyName?: string | null;
  legalName?: string | null;
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
};

export type CloseoutSummaryData = {
  jobNumber: string;
  title?: string | null;
  primeContractorName?: string | null;
  workflowName?: string | null;
  workflowVersion?: number | null;
  address?: string | null;
  revision: number;
  generatedAt: string;
  splicePoints: {
    label: string;
    closureType?: string | null;
    closureId?: string | null;
    placement?: string | null;
    gps?: string | null;
  }[];
  cables: { label: string; fiberCount: number; placement?: string | null }[];
  manifestFiles: { name: string; category: string }[];
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', color: '#1a1a1a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, borderBottom: '2 solid #1e40af', paddingBottom: 10 },
  logo: { width: 120, height: 40, objectFit: 'contain' },
  company: { fontSize: 14, fontWeight: 'bold', color: '#1e40af' },
  small: { fontSize: 8, color: '#555' },
  title: { fontSize: 16, fontWeight: 'bold', marginBottom: 2 },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 11, fontWeight: 'bold', color: '#1e40af', marginBottom: 6, textTransform: 'uppercase' },
  row: { flexDirection: 'row', borderBottom: '0.5 solid #ddd', paddingVertical: 3 },
  th: { fontWeight: 'bold', backgroundColor: '#f1f5f9', paddingVertical: 4 },
  cell: { flex: 1, paddingRight: 6 },
  cellNarrow: { width: 60, paddingRight: 6 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  metaItem: { width: '50%', marginBottom: 3 },
  label: { fontSize: 8, color: '#777' },
  value: { fontSize: 10 },
  footer: { position: 'absolute', bottom: 24, left: 36, right: 36, fontSize: 7, color: '#888', textAlign: 'center', borderTop: '0.5 solid #ddd', paddingTop: 6 },
});

export function CloseoutSummaryPDF({ data, branding }: { data: CloseoutSummaryData; branding: Branding }) {
  const company = branding.companyName || 'OS1 Fiber Track Pro';
  const contact = [branding.address, [branding.city, branding.state, branding.zip].filter(Boolean).join(', '), branding.phone, branding.email, branding.website].filter(Boolean);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.company}>{company}</Text>
            {branding.tagline ? <Text style={styles.small}>{branding.tagline}</Text> : null}
            {contact.map((c, i) => (
              <Text key={i} style={styles.small}>{c}</Text>
            ))}
          </View>
          {branding.logoUrl ? <Image style={styles.logo} src={branding.logoUrl} /> : null}
        </View>

        <Text style={styles.title}>Fiber Construction Closeout Summary</Text>
        <Text style={styles.small}>Job {data.jobNumber}{data.title ? ` — ${data.title}` : ''}</Text>

        <View style={[styles.section, styles.meta]}>
          <View style={styles.metaItem}><Text style={styles.label}>Prime Contractor</Text><Text style={styles.value}>{data.primeContractorName || '—'}</Text></View>
          <View style={styles.metaItem}><Text style={styles.label}>Documentation Workflow</Text><Text style={styles.value}>{data.workflowName || '—'}{data.workflowVersion ? ` (v${data.workflowVersion})` : ''}</Text></View>
          <View style={styles.metaItem}><Text style={styles.label}>Job Address</Text><Text style={styles.value}>{data.address || '—'}</Text></View>
          <View style={styles.metaItem}><Text style={styles.label}>Closeout Revision</Text><Text style={styles.value}>#{data.revision}</Text></View>
          <View style={styles.metaItem}><Text style={styles.label}>Generated</Text><Text style={styles.value}>{data.generatedAt}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Splice Points ({data.splicePoints.length})</Text>
          <View style={[styles.row, styles.th]}>
            <Text style={styles.cell}>Splice Point</Text>
            <Text style={styles.cell}>Closure ID</Text>
            <Text style={styles.cell}>Type</Text>
            <Text style={styles.cellNarrow}>Placement</Text>
            <Text style={styles.cell}>GPS</Text>
          </View>
          {data.splicePoints.map((sp, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.cell}>{sp.label}</Text>
              <Text style={styles.cell}>{sp.closureId || '—'}</Text>
              <Text style={styles.cell}>{sp.closureType || '—'}</Text>
              <Text style={styles.cellNarrow}>{sp.placement && sp.placement !== 'UNKNOWN' ? sp.placement : '—'}</Text>
              <Text style={styles.cell}>{sp.gps || '—'}</Text>
            </View>
          ))}
          {data.splicePoints.length === 0 ? <Text style={styles.small}>No splice points recorded.</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cable Inventory ({data.cables.length})</Text>
          <View style={[styles.row, styles.th]}>
            <Text style={styles.cell}>Cable</Text>
            <Text style={styles.cellNarrow}>Fiber Count</Text>
            <Text style={styles.cell}>Placement</Text>
          </View>
          {data.cables.map((c, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.cell}>{c.label}</Text>
              <Text style={styles.cellNarrow}>{c.fiberCount}</Text>
              <Text style={styles.cell}>{c.placement && c.placement !== 'UNKNOWN' ? c.placement : '—'}</Text>
            </View>
          ))}
          {data.cables.length === 0 ? <Text style={styles.small}>No cables recorded.</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Package Contents</Text>
          {data.manifestFiles.map((f, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.cell}>{f.name}</Text>
              <Text style={styles.cell}>{f.category}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.footer} fixed>
          {company} — Closeout package for Job {data.jobNumber}. This document contains as-built delivery information only.
        </Text>
      </Page>
    </Document>
  );
}
