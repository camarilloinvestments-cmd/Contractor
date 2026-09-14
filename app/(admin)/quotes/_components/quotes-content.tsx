'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Download, Eye, Send, Mail, ArrowRightLeft, Check, X, Loader2, Trash2 } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { formatCents, formatDate } from '@/lib/utils/format';
import { FadeIn } from '@/components/ui/animate';
import { toast } from 'sonner';

type LineRow = { description: string; quantity: string; unit: string; unitPrice: string };
const emptyLine = (): LineRow => ({ description: '', quantity: '1', unit: '', unitPrice: '' });

export function QuotesContent() {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [contractors, setContractors] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [primeId, setPrimeId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [taxRate, setTaxRate] = useState('0');
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

  const [sendTarget, setSendTarget] = useState<any | null>(null);
  const [sendTo, setSendTo] = useState('');
  const [sending, setSending] = useState(false);

  const [acceptTarget, setAcceptTarget] = useState<any | null>(null);
  const [acceptName, setAcceptName] = useState('');
  const [acceptEmail, setAcceptEmail] = useState('');
  const [acceptNote, setAcceptNote] = useState('');

  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchData = () => {
    Promise.all([
      fetch('/api/quotes').then(r => r.json()),
      fetch('/api/prime-contractors').then(r => r.json()),
    ]).then(([q, con]) => {
      setQuotes(q?.quotes ?? []);
      setContractors(Array.isArray(con) ? con : []);
    }).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (primeId) {
      fetch(`/api/projects?primeId=${primeId}`).then(r => r.json()).then(p => setProjects(Array.isArray(p) ? p : [])).catch(console.error);
    } else { setProjects([]); }
    setProjectId('');
  }, [primeId]);

  const setLine = (i: number, patch: Partial<LineRow>) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine = () => setLines(prev => [...prev, emptyLine()]);
  const removeLine = (i: number) => setLines(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);
  const resetForm = () => { setPrimeId(''); setProjectId(''); setTitle(''); setTaxRate('0'); setLines([emptyLine()]); };

  const handleCreate = async () => {
    if (!primeId) return toast.error('Select a prime contractor');
    const items = lines
      .filter(l => l.description.trim())
      .map(l => ({ description: l.description.trim(), quantity: Number(l.quantity) || 0, unit: l.unit || null, unitPrice: Math.round((Number(l.unitPrice) || 0) * 100) }));
    if (items.length === 0) return toast.error('Add at least one line item');
    setSaving(true);
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primeContractorId: primeId, projectId: projectId || null, title: title || null, taxRate: parseFloat(taxRate || '0'), items }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error ?? 'Failed'); }
      toast.success('Quote created');
      setShowCreate(false); resetForm(); fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Failed to create quote'); } finally { setSaving(false); }
  };

  const openPreview = (id: string) => window.open(`/api/quotes/${id}/preview`, '_blank');
  const downloadPdf = (id: string, num: string) => {
    const a = document.createElement('a');
    a.href = `/api/quotes/${id}/pdf`; a.download = `${num || 'quote'}.pdf`; a.click();
  };

  const handleSend = async () => {
    if (!sendTarget) return;
    setSending(true);
    try {
      const res = await fetch(`/api/quotes/${sendTarget.id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: sendTo || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error ?? 'Failed to send');
      toast.success('Quote sent');
      setSendTarget(null); fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Failed to send quote'); } finally { setSending(false); }
  };

  const handleAccept = async () => {
    if (!acceptTarget) return;
    try {
      const res = await fetch(`/api/quotes/${acceptTarget.id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptedByName: acceptName || null, acceptedByEmail: acceptEmail || null, acceptanceNote: acceptNote || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Failed to accept');
      toast.success('Quote accepted');
      setAcceptTarget(null); setAcceptName(''); setAcceptEmail(''); setAcceptNote(''); fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Failed to accept quote'); }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    try {
      const res = await fetch(`/api/quotes/${rejectTarget.id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectionReason: rejectReason || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Failed to reject');
      toast.success('Quote rejected');
      setRejectTarget(null); setRejectReason(''); fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Failed to reject quote'); }
  };

  const handleConvert = async (q: any) => {
    if (!confirm(`Convert accepted quote ${q?.quoteNumber} to a work order? The agreed line snapshots and price book provenance will be preserved.`)) return;
    try {
      const res = await fetch(`/api/quotes/${q.id}/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Failed to convert');
      toast.success('Converted to work order');
      fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Failed to convert quote'); }
  };

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight">Quotes</h1>
            <p className="text-muted-foreground">Issue, send, accept, and convert firm quotes to work orders</p>
          </div>
          <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Create Quote</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>New Quote</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Prime Contractor</Label>
                    <Select value={primeId} onValueChange={setPrimeId}>
                      <SelectTrigger><SelectValue placeholder="Select contractor" /></SelectTrigger>
                      <SelectContent>{contractors.map((c: any) => <SelectItem key={c?.id} value={c?.id ?? ''}>{c?.companyName ?? ''}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Project (optional)</Label>
                    <Select value={projectId} onValueChange={setProjectId} disabled={!primeId}>
                      <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                      <SelectContent>{projects.map((p: any) => <SelectItem key={p?.id} value={p?.id ?? ''}>{p?.projectName ?? p?.projectCode ?? ''}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>Title (optional)</Label><Input value={title} onChange={(e: any) => setTitle(e.target.value)} placeholder="e.g. Underground fiber — Route 12" /></div>
                <div>
                  <div className="flex items-center justify-between mb-2"><Label>Line Items</Label><Button type="button" variant="outline" size="sm" onClick={addLine}><Plus className="w-3 h-3 mr-1" />Add line</Button></div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {lines.map((l, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <Input className="col-span-5" placeholder="Description" value={l.description} onChange={(e: any) => setLine(i, { description: e.target.value })} />
                        <Input className="col-span-2" type="number" step="0.01" placeholder="Qty" value={l.quantity} onChange={(e: any) => setLine(i, { quantity: e.target.value })} />
                        <Input className="col-span-2" placeholder="Unit" value={l.unit} onChange={(e: any) => setLine(i, { unit: e.target.value })} />
                        <Input className="col-span-2" type="number" step="0.01" placeholder="Unit $" value={l.unitPrice} onChange={(e: any) => setLine(i, { unitPrice: e.target.value })} />
                        <Button type="button" variant="ghost" size="icon-sm" className="col-span-1" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="w-40"><Label>Tax Rate (%)</Label><Input type="number" step="0.01" value={taxRate} onChange={(e: any) => setTaxRate(e.target.value)} /></div>
                <Button onClick={handleCreate} disabled={saving} className="w-full">{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Create Quote</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </FadeIn>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote #</TableHead>
                <TableHead>Contractor</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
              ) : quotes.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No quotes yet</TableCell></TableRow>
              ) : quotes.map((q: any) => (
                <TableRow key={q?.id}>
                  <TableCell className="font-mono font-medium">{q?.quoteNumber ?? ''}</TableCell>
                  <TableCell>{q?.primeContractor?.companyName ?? ''}</TableCell>
                  <TableCell className="text-muted-foreground">{q?.project?.projectName ?? '—'}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatCents(q?.total)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(q?.createdAt)}</TableCell>
                  <TableCell><StatusBadge status={q?.status} /></TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      <Button variant="ghost" size="icon-sm" title="Preview" onClick={() => openPreview(q?.id)}><Eye className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon-sm" title="Download PDF" onClick={() => downloadPdf(q?.id, q?.quoteNumber)}><Download className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => { setSendTarget(q); setSendTo(''); }}>{(q?.sendCount ?? 0) > 0 ? <><Mail className="w-4 h-4 mr-1" />Resend</> : <><Send className="w-4 h-4 mr-1" />Send</>}</Button>
                      {['DRAFT','SENT','VIEWED'].includes(q?.status) && (
                        <>
                          <Button variant="ghost" size="sm" title="Accept" onClick={() => { setAcceptTarget(q); }}><Check className="w-4 h-4 mr-1" />Accept</Button>
                          <Button variant="ghost" size="sm" title="Reject" onClick={() => { setRejectTarget(q); }}><X className="w-4 h-4 mr-1" />Reject</Button>
                        </>
                      )}
                      {q?.status === 'ACCEPTED' && !q?.convertedToJobId && (
                        <Button variant="ghost" size="sm" title="Convert to Work Order" onClick={() => handleConvert(q)}><ArrowRightLeft className="w-4 h-4 mr-1" />To Work Order</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!sendTarget} onOpenChange={(o: boolean) => !o && setSendTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send Quote {sendTarget?.quoteNumber ?? ''}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">A branded PDF of this quote will be emailed using the configured email settings.</p>
            <div><Label>Recipient Email</Label><Input type="email" value={sendTo} placeholder="contact@example.com" onChange={(e: any) => setSendTo(e.target.value)} /></div>
            <Button onClick={handleSend} disabled={sending} className="w-full">{sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}Send Quote</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!acceptTarget} onOpenChange={(o: boolean) => !o && setAcceptTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Accept Quote {acceptTarget?.quoteNumber ?? ''}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Recording acceptance pins the price book version and agreed rates so a work order can be created from the exact terms.</p>
            <div><Label>Accepted By (name)</Label><Input value={acceptName} onChange={(e: any) => setAcceptName(e.target.value)} placeholder="Authorizing contact" /></div>
            <div><Label>Accepted By (email)</Label><Input type="email" value={acceptEmail} onChange={(e: any) => setAcceptEmail(e.target.value)} placeholder="contact@example.com" /></div>
            <div><Label>Note (optional)</Label><Textarea value={acceptNote} onChange={(e: any) => setAcceptNote(e.target.value)} /></div>
            <Button onClick={handleAccept} className="w-full"><Check className="w-4 h-4 mr-2" />Confirm Acceptance</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={(o: boolean) => !o && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Quote {rejectTarget?.quoteNumber ?? ''}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Reason (optional)</Label><Textarea value={rejectReason} onChange={(e: any) => setRejectReason(e.target.value)} /></div>
            <Button onClick={handleReject} variant="destructive" className="w-full"><X className="w-4 h-4 mr-2" />Confirm Rejection</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
