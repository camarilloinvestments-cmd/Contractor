'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, Download, Mail, Send, X, RefreshCw } from 'lucide-react';
import { formatCents, formatDate } from '@/lib/utils/format';
import { StatusBadge } from '@/components/status-badge';

export type DocKind = 'estimate' | 'quote' | 'invoice';

type LineSnapshot = {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  amount: number;
  jobCode: string | null;
};
type Snapshot = {
  documentType: string;
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
  notes: string | null;
};
type Branding = {
  companyName: string | null;
  logoUrl: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  primaryColor: string | null;
};
type EmailPreview = { subject: string; html: string; text: string; to: string | null };

const LABELS: Record<DocKind, { title: string; issue: string; expiry: string; listPath: string }> = {
  estimate: { title: 'Estimate', issue: 'Issue Date', expiry: 'Valid Until', listPath: '/estimates' },
  quote: { title: 'Quote', issue: 'Issue Date', expiry: 'Valid Until', listPath: '/quotes' },
  invoice: { title: 'Invoice', issue: 'Invoice Date', expiry: 'Due Date', listPath: '/invoices' },
};

export function CommercialDocPreview({ kind, id }: { kind: DocKind; id: string }) {
  const router = useRouter();
  const L = LABELS[kind];

  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);

  const [emailOpen, setEmailOpen] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [email, setEmail] = useState<EmailPreview | null>(null);

  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch(`/api/${kind}s/${id}/preview`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data?.snapshot) throw new Error('Malformed response');
      setSnapshot(data.snapshot as Snapshot);
      setBranding((data.branding ?? null) as Branding | null);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [kind, id]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  const downloadPdf = () => {
    const a = document.createElement('a');
    a.href = `/api/${kind}s/${id}/pdf`;
    a.setAttribute('download', '');
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openEmail = async () => {
    setEmailOpen(true);
    setEmailLoading(true);
    setEmailError(null);
    try {
      const res = await fetch(`/api/${kind}s/${id}/preview?mode=email`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data?.email) throw new Error('Malformed response');
      setEmail(data.email as EmailPreview);
    } catch {
      setEmailError('Could not load the email preview. Please try again.');
    } finally {
      setEmailLoading(false);
    }
  };

  const sendDoc = async () => {
    if (!confirm(`Send this ${L.title.toLowerCase()} to the contractor by email?`)) return;
    setSending(true);
    setSendMsg(null);
    try {
      const res = await fetch(`/api/${kind}s/${id}/send`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setSendMsg(`${L.title} sent successfully.`);
      await load();
    } catch (e: any) {
      setSendMsg(e?.message ? `Send failed: ${e.message}` : 'Send failed. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p>Loading {L.title.toLowerCase()} preview…</p>
        </div>
      </div>
    );
  }

  if (status === 'error' || !snapshot) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div>
            <p className="font-semibold">Could not load this {L.title.toLowerCase()}</p>
            <p className="text-sm text-muted-foreground">
              The preview failed to load. This is a connection or server problem.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push(L.listPath)}>
              <X className="mr-2 h-4 w-4" /> Close
            </Button>
            <Button onClick={load}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const accent = branding?.primaryColor || '#1e40af';
  const prime = snapshot.primeContractor;
  const companyLines = [
    branding?.address,
    [branding?.city, branding?.state, branding?.zip].filter(Boolean).join(', '),
    branding?.phone,
    branding?.email,
    branding?.website,
  ].filter((x) => x && String(x).trim().length > 0) as string[];
  const primeAddr = prime
    ? ([prime.address, [prime.city, prime.state, prime.zip].filter(Boolean).join(', ')].filter(
        (x) => x && String(x).trim().length > 0,
      ) as string[])
    : [];
  const taxPct = (snapshot.taxRate ?? 0) / 100;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{L.title} Preview</h1>
          <StatusBadge status={snapshot.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadPdf}>
            <Download className="mr-2 h-4 w-4" /> Download PDF
          </Button>
          <Button variant="outline" onClick={openEmail}>
            <Mail className="mr-2 h-4 w-4" /> Preview Email
          </Button>
          <Button onClick={sendDoc} disabled={sending}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send
          </Button>
          <Button variant="ghost" onClick={() => router.push(L.listPath)}>
            <X className="mr-2 h-4 w-4" /> Close
          </Button>
        </div>
      </div>

      {sendMsg && (
        <div className="mb-4 rounded-md border bg-muted/50 px-4 py-2 text-sm print:hidden">{sendMsg}</div>
      )}

      <div className="overflow-hidden rounded-lg border bg-white text-slate-900 shadow-sm">
        <div className="h-2" style={{ backgroundColor: accent }} />
        <div className="p-6 sm:p-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex items-start gap-4">
              {branding?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={branding.logoUrl} alt={branding?.companyName || 'Company logo'} className="h-14 w-auto object-contain" />
              ) : null}
              <div>
                <div className="text-xl font-bold" style={{ color: accent }}>
                  {branding?.companyName || 'OS1 Fiber Track Pro'}
                </div>
                {companyLines.map((l, i) => (
                  <div key={i} className="text-xs text-slate-500">{l}</div>
                ))}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold uppercase tracking-wide" style={{ color: accent }}>{L.title}</div>
              <div className="mt-1 font-mono text-sm">{snapshot.documentNumber}</div>
              {snapshot.title ? <div className="mt-1 text-sm text-slate-600">{snapshot.title}</div> : null}
              <div className="mt-2 grid grid-cols-2 gap-x-4 text-xs">
                <div className="text-slate-400">{L.issue}</div>
                <div className="text-right">{formatDate(snapshot.issueDate)}</div>
                {snapshot.expirationDate ? (
                  <>
                    <div className="text-slate-400">{L.expiry}</div>
                    <div className="text-right">{formatDate(snapshot.expirationDate)}</div>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Bill To</div>
              <div className="mt-1 font-medium">{prime?.companyName || '—'}</div>
              {prime?.contactName ? <div className="text-sm text-slate-600">{prime.contactName}</div> : null}
              {primeAddr.map((l, i) => (
                <div key={i} className="text-sm text-slate-600">{l}</div>
              ))}
              {prime?.email ? <div className="text-sm text-slate-600">{prime.email}</div> : null}
            </div>
            {snapshot.project?.projectName ? (
              <div className="sm:text-right">
                <div className="text-xs font-semibold uppercase text-slate-400">Project</div>
                <div className="mt-1 text-sm">
                  {snapshot.project.projectName}
                  {snapshot.project.projectCode ? ` (${snapshot.project.projectCode})` : ''}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-8 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr style={{ backgroundColor: accent }} className="text-white">
                  <th className="px-3 py-2 text-left font-semibold">Description</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Unit Price</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-400">No line items.</td>
                  </tr>
                ) : (
                  snapshot.items.map((it, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-3 py-2 align-top">
                        {it.description}
                        {it.jobCode ? <span className="ml-1 font-mono text-xs text-slate-400">{it.jobCode}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right align-top font-mono">
                        {it.quantity}{it.unit ? ` ${it.unit}` : ''}
                      </td>
                      <td className="px-3 py-2 text-right align-top font-mono">{formatCents(it.unitPrice)}</td>
                      <td className="px-3 py-2 text-right align-top font-mono">{formatCents(it.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex justify-end">
            <table className="w-full max-w-xs text-sm">
              <tbody>
                <tr><td className="py-1 text-slate-600">Subtotal</td><td className="py-1 text-right font-mono">{formatCents(snapshot.subtotal)}</td></tr>
                {snapshot.taxAmount ? (
                  <tr><td className="py-1 text-slate-600">Tax ({taxPct}%)</td><td className="py-1 text-right font-mono">{formatCents(snapshot.taxAmount)}</td></tr>
                ) : null}
                <tr className="border-t border-slate-200">
                  <td className="py-2 font-semibold">Total</td>
                  <td className="py-2 text-right font-mono text-base font-bold" style={{ color: accent }}>{formatCents(snapshot.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {(snapshot.terms || snapshot.exclusions || snapshot.assumptions || snapshot.notes) ? (
            <div className="mt-8 space-y-4">
              {snapshot.terms ? (
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-400">Terms</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{snapshot.terms}</p>
                </div>
              ) : null}
              {snapshot.assumptions ? (
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-400">Assumptions</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{snapshot.assumptions}</p>
                </div>
              ) : null}
              {snapshot.exclusions ? (
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-400">Exclusions</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{snapshot.exclusions}</p>
                </div>
              ) : null}
              {snapshot.notes ? (
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-400">Notes</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{snapshot.notes}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {emailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden" onClick={() => setEmailOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-lg bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-semibold">Email Preview</h2>
              <Button variant="ghost" size="icon-sm" onClick={() => setEmailOpen(false)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-4">
              {emailLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading email…
                </div>
              ) : emailError ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <AlertTriangle className="h-8 w-8 text-destructive" />
                  <p className="text-sm text-muted-foreground">{emailError}</p>
                  <Button variant="outline" onClick={openEmail}><RefreshCw className="mr-2 h-4 w-4" /> Retry</Button>
                </div>
              ) : email ? (
                <div className="space-y-3">
                  <div className="text-sm"><span className="text-muted-foreground">To:</span> {email.to || '—'}</div>
                  <div className="text-sm"><span className="text-muted-foreground">Subject:</span> {email.subject}</div>
                  <div className="rounded-md border bg-white p-4 text-slate-900" dangerouslySetInnerHTML={{ __html: email.html }} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
