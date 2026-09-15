'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Sparkles, ArrowLeft, Save, Check, X, AlertTriangle, FileText, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

type Item = {
  id: string; orderIndex: number; deviceId: string | null; proposedType: string | null;
  routeSection: string | null; instructions: string | null; confidence: number;
  requiresReview: boolean; reviewReason: string | null; reentryRequired: boolean;
  reentryReason: string | null; partialWorkAllowed: boolean; possibleDuplicate: boolean;
  proposedBillingCode: string | null; reviewStatus: string; mappedTaskTypeId: string | null;
  confirmedJobCode: string | null; quantity: number | null; resultingTaskId: string | null;
};
type Source = { id: string; kind: string; originalFilename: string | null; sizeBytes: number | null; sentToAi: boolean };
type Intake = {
  id: string; intakeNumber: string; status: string; title: string | null;
  pastedText: string | null; primeContractorId: string; projectId: string | null;
  priorityRawText: string | null; priorityOrder: any; warnings: any; confidenceSummary: any;
  error: string | null; modelUsed: string | null; usedFallback: boolean; resultingJobId: string | null;
  sources: Source[]; items: Item[];
};
type TaskType = { id: string; name: string };

const STATUS_STYLE: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-700', ANALYZING: 'bg-blue-100 text-blue-700',
  NEEDS_REVIEW: 'bg-amber-100 text-amber-800', READY: 'bg-emerald-100 text-emerald-700',
  APPROVED: 'bg-emerald-100 text-emerald-700', IMPORTED: 'bg-primary/10 text-primary',
  REJECTED: 'bg-rose-100 text-rose-700', FAILED: 'bg-rose-100 text-rose-700',
};

function confidenceBadge(c: number) {
  if (c >= 0.9) return <Badge className="bg-emerald-100 text-emerald-700" variant="secondary">{Math.round(c * 100)}% High</Badge>;
  if (c >= 0.75) return <Badge className="bg-amber-100 text-amber-800" variant="secondary">{Math.round(c * 100)}% Med</Badge>;
  return <Badge className="bg-rose-100 text-rose-700" variant="secondary">{Math.round(c * 100)}% Low</Badge>;
}

export function IntakeReviewContent({ id }: { id: string }) {
  const router = useRouter();
  const [intake, setIntake] = useState<Intake | null>(null);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, Partial<Item>>>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [jobName, setJobName] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/ai-intake/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.intake) {
          setIntake(d.intake);
          setJobName(d.intake.title || `Work order from ${d.intake.intakeNumber}`);
          const inc: Record<string, boolean> = {};
          for (const it of d.intake.items as Item[]) inc[it.id] = it.reviewStatus !== 'REJECTED';
          setIncluded(inc);
        }
      })
      .catch(() => toast.error('Failed to load intake'))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch('/api/task-types').then((r) => r.json()).then((d) => setTaskTypes(Array.isArray(d) ? d : [])).catch(() => {}); }, []);

  const itemVal = (it: Item, k: keyof Item): any => (edits[it.id]?.[k] !== undefined ? edits[it.id]![k] : it[k]);
  const setItem = (itemId: string, k: keyof Item, v: any) => setEdits((p) => ({ ...p, [itemId]: { ...p[itemId], [k]: v } }));

  const finalized = intake?.status === 'IMPORTED' || intake?.status === 'REJECTED';

  const analyze = async () => {
    setBusy(true);
    try {
      toast.info('Analyzing with AI…');
      const res = await fetch(`/api/ai-intake/${id}/analyze`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Analysis failed');
      toast.success('Analysis complete');
      load();
    } catch (e: any) { toast.error(e.message || 'Analysis failed'); } finally { setBusy(false); }
  };

  const saveEdits = async () => {
    const items = Object.entries(edits).map(([itemId, data]) => ({ id: itemId, ...data }));
    if (items.length === 0) { toast.info('No changes to save'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/ai-intake/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Save failed');
      setEdits({});
      setIntake(d.intake);
      toast.success('Draft saved');
    } catch (e: any) { toast.error(e.message || 'Save failed'); } finally { setBusy(false); }
  };

  const doApprove = async () => {
    if (!intake) return;
    if (!jobName.trim()) { toast.error('Enter a work order name'); return; }
    const itemDecisions = intake.items
      .filter((it) => included[it.id])
      .map((it) => ({
        itemId: it.id,
        taskTypeId: (itemVal(it, 'mappedTaskTypeId') as string) || '',
        jobCode: (itemVal(it, 'confirmedJobCode') as string) || null,
        quantity: (itemVal(it, 'quantity') as number) || 1,
      }));
    if (itemDecisions.length === 0) { toast.error('Select at least one item'); return; }
    const missing = itemDecisions.filter((d) => !d.taskTypeId);
    if (missing.length > 0) { toast.error('Every selected item needs a Task Type'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/ai-intake/${id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobName, itemDecisions }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Approval failed');
      toast.success('Work order created');
      setApproveOpen(false);
      if (d.job?.id) router.push(`/jobs/${d.job.id}`);
      else load();
    } catch (e: any) { toast.error(e.message || 'Approval failed'); } finally { setBusy(false); }
  };

  const doReject = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/ai-intake/${id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: rejectReason || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Reject failed');
      toast.success('Intake rejected');
      setRejectOpen(false);
      load();
    } catch (e: any) { toast.error(e.message || 'Reject failed'); } finally { setBusy(false); }
  };

  if (loading) return <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!intake) return <div className="p-8">Intake not found. <Link className="text-primary underline" href="/ai-help">Back</Link></div>;

  const priorityOrder: string[] = Array.isArray(intake.priorityOrder) ? intake.priorityOrder : [];
  const warnings: string[] = Array.isArray(intake.warnings) ? intake.warnings : [];
  const cs = intake.confidenceSummary || {};
  const canReview = ['NEEDS_REVIEW', 'READY', 'APPROVED'].includes(intake.status);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/ai-help"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">{intake.intakeNumber}</span>
              <Badge className={STATUS_STYLE[intake.status] || ''} variant="secondary">{intake.status.replace('_', ' ')}</Badge>
              {intake.usedFallback && <Badge variant="outline">fallback model</Badge>}
            </div>
            <h1 className="text-xl font-display font-bold truncate">{intake.title || 'Untitled work request'}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!finalized && (
            <Button variant="outline" onClick={analyze} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              {intake.status === 'NEW' ? 'Analyze with AI' : 'Re-analyze'}
            </Button>
          )}
        </div>
      </div>

      {intake.status === 'FAILED' && intake.error && (
        <Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertTitle>Analysis failed</AlertTitle>
          <AlertDescription>{intake.error} — your sources and any prior draft are preserved. You can re-analyze.</AlertDescription></Alert>
      )}

      {intake.resultingJobId && (
        <Alert><Check className="h-4 w-4" /><AlertTitle>Work order created</AlertTitle>
          <AlertDescription>This intake was imported. <Link className="text-primary underline" href={`/jobs/${intake.resultingJobId}`}>View work order</Link></AlertDescription></Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Priority (as stated by prime)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {intake.priorityRawText ? (
              <p className="text-sm bg-muted/40 rounded p-3 font-mono">{intake.priorityRawText}</p>
            ) : <p className="text-sm text-muted-foreground">No explicit priority stated.</p>}
            {priorityOrder.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {priorityOrder.map((p, i) => <Badge key={i} variant="outline">{i + 1}. {p}</Badge>)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Confidence</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="flex justify-between"><span className="text-emerald-700">High</span><span>{cs.high ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-amber-700">Medium</span><span>{cs.medium ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-rose-700">Low</span><span>{cs.low ?? 0}</span></div>
            <div className="flex justify-between border-t pt-1 mt-1"><span>Needs review</span><span className="font-medium">{cs.review ?? 0}</span></div>
          </CardContent>
        </Card>
      </div>

      {warnings.length > 0 && (
        <Alert className="border-amber-300"><AlertTriangle className="h-4 w-4 text-amber-600" /><AlertTitle>AI flags &amp; uncertainty</AlertTitle>
          <AlertDescription><ul className="list-disc pl-5 space-y-0.5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></AlertDescription></Alert>
      )}

      {intake.sources.length > 0 && (
        <Card><CardHeader><CardTitle className="text-base">Sources (originals preserved)</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {intake.sources.map((sc) => (
              <div key={sc.id} className="flex items-center gap-2 text-sm border rounded px-3 py-1.5">
                <FileText className="h-4 w-4" /><span>{sc.originalFilename || sc.kind}</span>
                <Badge variant="outline">{sc.kind}</Badge>
                {sc.sentToAi && <Badge className="bg-blue-100 text-blue-700" variant="secondary">analyzed</Badge>}
              </div>
            ))}
          </CardContent></Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Extracted Items ({intake.items.length})</CardTitle>
          {!finalized && intake.items.length > 0 && (
            <Button variant="outline" size="sm" onClick={saveEdits} disabled={busy || Object.keys(edits).length === 0}>
              <Save className="h-4 w-4 mr-2" /> Save Edits
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {intake.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items yet. Run AI analysis to extract a structured draft.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {!finalized && <TableHead className="w-8">Use</TableHead>}
                    <TableHead>Device ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Section</TableHead>
                    <TableHead className="min-w-[220px]">Instructions</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Review</TableHead>
                    {!finalized && <TableHead className="min-w-[180px]">Task Type *</TableHead>}
                    {!finalized && <TableHead>Billing Code</TableHead>}
                    {!finalized && <TableHead className="w-20">Qty</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {intake.items.map((it) => (
                    <TableRow key={it.id} className={it.requiresReview ? 'bg-amber-50/50' : ''}>
                      {!finalized && (
                        <TableCell><Checkbox checked={!!included[it.id]} onCheckedChange={(v) => setIncluded((p) => ({ ...p, [it.id]: !!v }))} /></TableCell>
                      )}
                      <TableCell className="font-mono text-sm whitespace-nowrap">{it.deviceId || '—'}</TableCell>
                      <TableCell>
                        {finalized ? (itemVal(it, 'proposedType') || '—') : (
                          <Input className="h-8 w-28" value={itemVal(it, 'proposedType') || ''} onChange={(e) => setItem(it.id, 'proposedType', e.target.value)} />
                        )}
                      </TableCell>
                      <TableCell>
                        {finalized ? (itemVal(it, 'routeSection') || '—') : (
                          <Input className="h-8 w-20" value={itemVal(it, 'routeSection') || ''} onChange={(e) => setItem(it.id, 'routeSection', e.target.value)} />
                        )}
                      </TableCell>
                      <TableCell>
                        {finalized ? (itemVal(it, 'instructions') || '—') : (
                          <Textarea className="min-h-[36px] text-sm" rows={2} value={itemVal(it, 'instructions') || ''} onChange={(e) => setItem(it.id, 'instructions', e.target.value)} />
                        )}
                        {(it.reentryRequired || it.possibleDuplicate) && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {it.reentryRequired && <Badge variant="outline" className="text-amber-700 border-amber-300">re-entry: {it.reentryReason || 'required'}</Badge>}
                            {it.possibleDuplicate && <Badge variant="outline" className="text-rose-700 border-rose-300">possible duplicate</Badge>}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{confidenceBadge(it.confidence)}</TableCell>
                      <TableCell>
                        {it.requiresReview
                          ? <Badge className="bg-amber-100 text-amber-800" variant="secondary" title={it.reviewReason || ''}>Review</Badge>
                          : <Badge className="bg-emerald-100 text-emerald-700" variant="secondary">OK</Badge>}
                        {it.reviewReason && <div className="text-xs text-muted-foreground mt-0.5 max-w-[160px]">{it.reviewReason}</div>}
                      </TableCell>
                      {!finalized && (
                        <TableCell>
                          <Select value={(itemVal(it, 'mappedTaskTypeId') as string) || ''} onValueChange={(v) => setItem(it.id, 'mappedTaskTypeId', v)}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="Select…" /></SelectTrigger>
                            <SelectContent>{taskTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                      )}
                      {!finalized && (
                        <TableCell>
                          <Input className="h-8 w-28 font-mono" placeholder={it.proposedBillingCode || 'code'} value={(itemVal(it, 'confirmedJobCode') as string) || ''} onChange={(e) => setItem(it.id, 'confirmedJobCode', e.target.value)} />
                          {it.proposedBillingCode && <div className="text-xs text-muted-foreground mt-0.5">AI suggests: {it.proposedBillingCode}</div>}
                        </TableCell>
                      )}
                      {!finalized && (
                        <TableCell>
                          <Input type="number" className="h-8 w-16" value={(itemVal(it, 'quantity') as number) ?? 1} onChange={(e) => setItem(it.id, 'quantity', e.target.value === '' ? null : Number(e.target.value))} />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {canReview && !intake.resultingJobId && (
        <div className="flex items-center justify-end gap-2 sticky bottom-4">
          <Button variant="outline" className="text-destructive" onClick={() => setRejectOpen(true)} disabled={busy}><X className="h-4 w-4 mr-2" /> Reject</Button>
          <Button onClick={() => setApproveOpen(true)} disabled={busy}><Check className="h-4 w-4 mr-2" /> Approve &amp; Create Work Order</Button>
        </div>
      )}

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Work Order</DialogTitle>
            <DialogDescription>A DRAFT work order is created for the selected items, pinned to the project&apos;s price book version. Billing codes and rates come only from the pinned version — never from AI.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2"><Label>Work Order Name *</Label><Input value={jobName} onChange={(e) => setJobName(e.target.value)} /></div>
            <p className="text-sm text-muted-foreground">{intake.items.filter((it) => included[it.id]).length} item(s) will become tasks. Each needs a Task Type.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={doApprove} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />} Create Work Order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Intake</DialogTitle><DialogDescription>The source and draft are kept for the audit trail. No work order is created.</DialogDescription></DialogHeader>
          <div className="grid gap-2"><Label>Reason (optional)</Label><Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={doReject} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <X className="h-4 w-4 mr-2" />} Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
