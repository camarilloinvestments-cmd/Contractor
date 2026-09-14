'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, Download, Mail, Send, X, RefreshCw } from 'lucide-react';
import { formatCents, formatDate } from '@/lib/utils/format';
import { StatusBadge } from '@/components/status-badge';

// ---- Types mirror the statement preview API response ----
type LineSnapshot = {
  lineType: string;
  refNumber: string | null;
  date: string | null;
  description: string;
  charges: number;
  credits: number;
  balance: number;
};
type Snapshot = {
  documentType: 'STATEMENT';
  documentNumber: string;
  status: string;
  statementDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
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
  openingBalance: number;
  invoicedAmount: number;
  paymentsAmount: number;
  endingBalance: number;
  aging: { current: number; d1to30: number; d31to60: number; d61to90: number; d91plus: number };
  lines: LineSnapshot[];
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

export default function StatementPreviewPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id ?? '');

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
      const res = await fetch(`/api/statements/${id}/preview`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data?.snapshot) throw new Error('Malformed response');
      setSnapshot(data.snapshot as Snapshot);
      setBranding((data.branding ?? null) as Branding | null);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [id]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  const downloadPdf = () => {
    const a = document.createElement('a');
    a.href = `/api/statements/${id}/pdf`;
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
      const res = await fetch(`/api/statements/${id}/preview?mode=email`, { cache: 'no-store' });
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

  const sendStatement = async () => {
    if (!confirm('Send this statement to the contractor by email?')) return;
    setSending(true);
    setSendMsg(null);
    try {
      const res = await fetch(`/api/statements/${id}/send`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setSendMsg('Statement sent successfully.');
      await load();
    } catch (e: any) {
      setSendMsg(e?.message ? `Send failed: ${e.message}` : 'Send failed. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // ---------- LOADING ----------
  if (status === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p>Loading statement preview…</p>
        </div>
      </div>
    );
  }

  // ---------- ERROR (load failed) ----------
  if (status === 'error' || !snapshot) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div>
            <p className="font-semibold">Could not load this statement</p>
            <p className="text-sm text-muted-foreground">
              The preview failed to load. This is a connection or server problem, not an empty statement.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push('/statements')}>
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

  // ---------- READY (branded document) ----------
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      {/* Action bar (not part of the printed document) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Statement Preview</h1>
          <StatusBadge status={snapshot.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadPdf}>
            <Download className="mr-2 h-4 w-4" /> Download PDF
          </Button>
          <Button variant="outline" onClick={openEmail}>
            <Mail className="mr-2 h-4 w-4" /> Preview Email
          </Button>
          <Button onClick={sendStatement} disabled={sending}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {snapshot.status === 'SENT' ? 'Resend' : 'Send'}
          </Button>
          <Button variant="ghost" onClick={() => router.push('/statements')}>
            <X className="mr-2 h-4 w-4" /> Close
          </Button>
        </div>
      </div>

      {sendMsg && (
        <div className="mb-4 rounded-md border bg-muted/50 px-4 py-2 text-sm print:hidden">{sendMsg}</div>
      )}

      {/* Branded document */}
      <div className="overflow-hidden rounded-lg border bg-white text-slate-900 shadow-sm">
        <div className="h-2" style={{ backgroundColor: accent }} />
        <div className="p-6 sm:p-10">
          {/* Header */}
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
              <div className="text-2xl font-bold uppercase tracking-wide" style={{ color: accent }}>Statement</div>
              <div className="mt-1 font-mono text-sm">{snapshot.documentNumber}</div>
              <div className="mt-2 text-xs text-slate-500">Statement Date</div>
              <div className="text-sm">{formatDate(snapshot.statementDate)}</div>
            </div>
          </div>

          {/* Bill-to + period */}
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Statement For</div>
              <div className="mt-1 font-medium">{prime?.companyName || '—'}</div>
              {prime?.contactName ? <div className="text-sm text-slate-600">{prime.contactName}</div> : null}
              {primeAddr.map((l, i) => (
                <div key={i} className="text-sm text-slate-600">{l}</div>
              ))}
              {prime?.email ? <div className="text-sm text-slate-600">{prime.email}</div> : null}
            </div>
            <div className="sm:text-right">
              <div className="text-xs font-semibold uppercase text-slate-400">Period</div>
              <div className="mt-1 text-sm">
                {formatDate(snapshot.periodStart)} &ndash; {formatDate(snapshot.periodEnd)}
              </div>
              {snapshot.project?.projectName ? (
                <>
                  <div className="mt-2 text-xs font-semibold uppercase text-slate-400">Project</div>
                  <div className="text-sm">
                    {snapshot.project.projectName}
                    {snapshot.project.projectCode ? ` (${snapshot.project.projectCode})` : ''}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          {/* Ledger */}
          <div className="mt-8 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr style={{ backgroundColor: accent }} className="text-white">
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                  <th className="px-3 py-2 text-left font-semibold">Description</th>
                  <th className="px-3 py-2 text-right font-semibold">Charges</th>
                  <th className="px-3 py-2 text-right font-semibold">Credits</th>
                  <th className="px-3 py-2 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.lines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                      No activity in this period.
                    </td>
                  </tr>
                ) : (
                  snapshot.lines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-3 py-2 align-top">{l.date ? formatDate(l.date) : '—'}</td>
                      <td className="px-3 py-2 align-top">
                        {l.description}
                        {l.refNumber ? <span className="ml-1 font-mono text-xs text-slate-400">{l.refNumber}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right align-top font-mono">
                        {l.charges ? formatCents(l.charges) : ''}
                      </td>
                      <td className="px-3 py-2 text-right align-top font-mono">
                        {l.credits ? formatCents(l.credits) : ''}
                      </td>
                      <td className="px-3 py-2 text-right align-top font-mono">{formatCents(l.balance)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Summary + Aging */}
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Aging</div>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  <tr><td className="py-1 text-slate-600">Current</td><td className="py-1 text-right font-mono">{formatCents(snapshot.aging.current)}</td></tr>
                  <tr><td className="py-1 text-slate-600">1&ndash;30 days</td><td className="py-1 text-right font-mono">{formatCents(snapshot.aging.d1to30)}</td></tr>
                  <tr><td className="py-1 text-slate-600">31&ndash;60 days</td><td className="py-1 text-right font-mono">{formatCents(snapshot.aging.d31to60)}</td></tr>
                  <tr><td className="py-1 text-slate-600">61&ndash;90 days</td><td className="py-1 text-right font-mono">{formatCents(snapshot.aging.d61to90)}</td></tr>
                  <tr><td className="py-1 text-slate-600">91+ days</td><td className="py-1 text-right font-mono">{formatCents(snapshot.aging.d91plus)}</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Summary</div>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  <tr><td className="py-1 text-slate-600">Opening Balance</td><td className="py-1 text-right font-mono">{formatCents(snapshot.openingBalance)}</td></tr>
                  <tr><td className="py-1 text-slate-600">Invoiced</td><td className="py-1 text-right font-mono">{formatCents(snapshot.invoicedAmount)}</td></tr>
                  <tr><td className="py-1 text-slate-600">Payments</td><td className="py-1 text-right font-mono">-{formatCents(snapshot.paymentsAmount)}</td></tr>
                  <tr className="border-t border-slate-200">
                    <td className="py-2 font-semibold">Balance Due</td>
                    <td className="py-2 text-right font-mono text-base font-bold" style={{ color: accent }}>{formatCents(snapshot.endingBalance)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {snapshot.notes ? (
            <div className="mt-8">
              <div className="text-xs font-semibold uppercase text-slate-400">Notes</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{snapshot.notes}</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Email preview modal */}
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
