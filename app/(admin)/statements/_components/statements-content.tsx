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
import { Plus, Download, Eye, Send, Mail, Loader2, AlertTriangle, FileText, RefreshCw } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { formatCents, formatDate } from '@/lib/utils/format';
import { FadeIn } from '@/components/ui/animate';
import { toast } from 'sonner';

export function StatementsContent() {
  const [statements, setStatements] = useState<any[]>([]);
  const [contractors, setContractors] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [primeId, setPrimeId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [statementDate, setStatementDate] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [sendTarget, setSendTarget] = useState<any | null>(null);
  const [sendTo, setSendTo] = useState('');
  const [sending, setSending] = useState(false);

  const fetchData = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch('/api/statements').then(r => { if (!r.ok) throw new Error('statements'); return r.json(); }),
      fetch('/api/prime-contractors').then(r => r.ok ? r.json() : []),
    ]).then(([st, con]) => {
      setStatements(st?.statements ?? []);
      setContractors(Array.isArray(con) ? con : []);
    }).catch(() => setError('Unable to load statements. Please retry.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (primeId) {
      fetch(`/api/projects?primeId=${primeId}`).then(r => r.ok ? r.json() : []).then(p => setProjects(Array.isArray(p) ? p : [])).catch(() => setProjects([]));
    } else { setProjects([]); }
    setProjectId('');
  }, [primeId]);

  const resetForm = () => { setPrimeId(''); setProjectId(''); setStatementDate(''); setPeriodStart(''); setPeriodEnd(''); setNotes(''); };

  const handleCreate = async () => {
    if (!primeId) return toast.error('Select a prime contractor');
    setSaving(true);
    try {
      const res = await fetch('/api/statements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primeContractorId: primeId,
          projectId: projectId || null,
          statementDate: statementDate || undefined,
          periodStart: periodStart || undefined,
          periodEnd: periodEnd || undefined,
          notes: notes || null,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error ?? 'Failed'); }
      toast.success('Statement generated');
      setShowCreate(false); resetForm(); fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Failed to generate statement'); } finally { setSaving(false); }
  };

  const openPreview = (id: string) => window.open(`/statements/${id}/preview`, '_blank');
  const downloadPdf = (id: string, num: string) => {
    const a = document.createElement('a');
    a.href = `/api/statements/${id}/pdf`; a.download = `${num || 'statement'}.pdf`; a.click();
  };

  const openSend = (st: any) => { setSendTarget(st); setSendTo(''); };
  const handleSend = async () => {
    if (!sendTarget) return;
    setSending(true);
    try {
      const res = await fetch(`/api/statements/${sendTarget.id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: sendTo || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error ?? 'Failed to send');
      toast.success('Statement sent');
      setSendTarget(null); fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Failed to send statement'); } finally { setSending(false); }
  };

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight">Statements</h1>
            <p className="text-muted-foreground">Generate, preview, and send account statements</p>
          </div>
          <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Generate Statement</Button></DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader><DialogTitle>Generate Statement</DialogTitle></DialogHeader>
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
                      <SelectTrigger><SelectValue placeholder="All projects" /></SelectTrigger>
                      <SelectContent>{projects.map((p: any) => <SelectItem key={p?.id} value={p?.id ?? ''}>{p?.projectName ?? p?.projectCode ?? ''}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div><Label>Statement Date</Label><Input type="date" value={statementDate} onChange={(e: any) => setStatementDate(e.target.value)} /></div>
                  <div><Label>Period Start</Label><Input type="date" value={periodStart} onChange={(e: any) => setPeriodStart(e.target.value)} /></div>
                  <div><Label>Period End</Label><Input type="date" value={periodEnd} onChange={(e: any) => setPeriodEnd(e.target.value)} /></div>
                </div>
                <p className="text-xs text-muted-foreground">Leave dates blank to use the current calendar month.</p>
                <div><Label>Notes (optional)</Label><Textarea value={notes} onChange={(e: any) => setNotes(e.target.value)} placeholder="Customer-facing note shown on the statement" /></div>
                <Button onClick={handleCreate} disabled={saving} className="w-full">{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Generate Statement</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </FadeIn>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mb-3" />
              <p className="text-sm">Loading statements…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16">
              <AlertTriangle className="w-8 h-8 text-destructive mb-3" />
              <p className="text-sm font-medium">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Retry</Button>
            </div>
          ) : statements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="w-8 h-8 mb-3" />
              <p className="text-sm font-medium">No statements yet</p>
              <p className="text-xs mt-1">Generate a statement to summarise a contractor&rsquo;s account activity.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Statement #</TableHead>
                  <TableHead>Contractor</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Balance Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statements.map((st: any) => (
                  <TableRow key={st?.id}>
                    <TableCell className="font-mono font-medium">{st?.statementNumber ?? ''}</TableCell>
                    <TableCell>{st?.primeContractor?.companyName ?? ''}</TableCell>
                    <TableCell className="text-muted-foreground">{st?.project?.projectName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{formatDate(st?.periodStart)} – {formatDate(st?.periodEnd)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatCents(st?.endingBalance)}</TableCell>
                    <TableCell><StatusBadge status={st?.status} /></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon-sm" title="Preview" onClick={() => openPreview(st?.id)}><Eye className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon-sm" title="Download PDF" onClick={() => downloadPdf(st?.id, st?.statementNumber)}><Download className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => openSend(st)}>{(st?.emailCount ?? 0) > 0 ? <><Mail className="w-4 h-4 mr-1" />Resend</> : <><Send className="w-4 h-4 mr-1" />Send</>}</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!sendTarget} onOpenChange={(o: boolean) => !o && setSendTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send Statement {sendTarget?.statementNumber ?? ''}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">A branded PDF of this statement will be emailed using the configured email settings.</p>
            <div><Label>Recipient Email</Label><Input type="email" value={sendTo} placeholder="contact@example.com" onChange={(e: any) => setSendTo(e.target.value)} /></div>
            <Button onClick={handleSend} disabled={sending} className="w-full">{sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}Send Statement</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
