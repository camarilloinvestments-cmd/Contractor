'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Sparkles, Plus, Upload, FileText, Trash2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

type Prime = { id: string; companyName: string };
type Project = { id: string; projectName: string; projectCode: string };
type Intake = {
  id: string; intakeNumber: string; status: string; title: string | null;
  createdAt: string; primeContractorId: string; projectId: string | null;
  _count?: { items: number; sources: number };
};
type Source = { id: string; kind: string; originalFilename: string | null; sizeBytes: number | null };

const STATUS_TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'inbox', label: 'Inbox', statuses: ['NEW', 'ANALYZING', 'FAILED'] },
  { key: 'review', label: 'Needs Review', statuses: ['NEEDS_REVIEW'] },
  { key: 'ready', label: 'Ready', statuses: ['READY', 'APPROVED'] },
  { key: 'imported', label: 'Imported', statuses: ['IMPORTED'] },
  { key: 'rejected', label: 'Rejected', statuses: ['REJECTED'] },
];

const STATUS_STYLE: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-700',
  ANALYZING: 'bg-blue-100 text-blue-700',
  NEEDS_REVIEW: 'bg-amber-100 text-amber-800',
  READY: 'bg-emerald-100 text-emerald-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  IMPORTED: 'bg-primary/10 text-primary',
  REJECTED: 'bg-rose-100 text-rose-700',
  FAILED: 'bg-rose-100 text-rose-700',
};

export function WorkIntakeContent() {
  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('inbox');
  const [createOpen, setCreateOpen] = useState(false);

  const loadIntakes = useCallback(() => {
    setLoading(true);
    fetch('/api/ai-intake')
      .then((r) => r.json())
      .then((d) => setIntakes(Array.isArray(d.intakes) ? d.intakes : []))
      .catch(() => toast.error('Failed to load intakes'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadIntakes(); }, [loadIntakes]);

  const activeTab = STATUS_TABS.find((t) => t.key === tab)!;
  const filtered = intakes.filter((i) => activeTab.statuses.includes(i.status));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><Sparkles className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-display font-bold">AI Work Intake</h1>
            <p className="text-sm text-muted-foreground">Import a Prime work request, analyze it with AI, review the draft, then create a Work Order. AI never creates records on its own.</p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-2" /> Import Work Request</Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {STATUS_TABS.map((t) => {
            const count = intakes.filter((i) => t.statuses.includes(i.status)).length;
            return (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}{count > 0 && <span className="ml-1.5 text-xs text-muted-foreground">({count})</span>}
              </TabsTrigger>
            );
          })}
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          {loading ? (
            <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">No work requests in this view.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((i) => (
                <Link key={i.id} href={`/ai-help/${i.id}`}>
                  <Card className="hover:border-primary/40 transition-colors">
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-muted-foreground">{i.intakeNumber}</span>
                          <span className="font-medium truncate">{i.title || 'Untitled work request'}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {i._count?.items ?? 0} items · {i._count?.sources ?? 0} sources · {new Date(i.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge className={STATUS_STYLE[i.status] || ''} variant="secondary">{i.status.replace('_', ' ')}</Badge>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CreateIntakeDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={loadIntakes} />
    </div>
  );
}

function CreateIntakeDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [primes, setPrimes] = useState<Prime[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [primeId, setPrimeId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch('/api/prime-contractors').then((r) => r.json()).then((d) => {
      setPrimes(Array.isArray(d) ? d : (d.primeContractors || d.primes || []));
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!primeId) { setProjects([]); setProjectId(''); return; }
    fetch(`/api/projects?primeId=${primeId}`).then((r) => r.json()).then((d) => {
      setProjects(Array.isArray(d) ? d : (d.projects || []));
    }).catch(() => {});
  }, [primeId]);

  const reset = () => {
    setPrimeId(''); setProjectId(''); setTitle(''); setPastedText(''); setFiles([]);
  };

  const submit = async (analyze: boolean) => {
    if (!primeId) { toast.error('Select a prime contractor'); return; }
    if (!pastedText.trim() && files.length === 0) { toast.error('Paste text or add at least one file'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/ai-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primeContractorId: primeId, projectId: projectId || null, title: title || null, pastedText: pastedText || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Create failed');
      const intakeId = d.intake.id;

      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        const up = await fetch(`/api/ai-intake/${intakeId}/sources`, { method: 'POST', body: fd });
        if (!up.ok) { const e = await up.json().catch(() => ({})); throw new Error(e.error || `Upload failed: ${f.name}`); }
      }

      if (analyze) {
        toast.info('Analyzing with AI…');
        const an = await fetch(`/api/ai-intake/${intakeId}/analyze`, { method: 'POST' });
        const ad = await an.json();
        if (!an.ok) toast.error(ad.error || 'Analysis failed — draft saved, retry from the intake');
      }

      toast.success('Work request imported');
      reset();
      onOpenChange(false);
      onCreated();
      window.location.href = `/ai-help/${intakeId}`;
    } catch (e: any) {
      toast.error(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Work Request</DialogTitle>
          <DialogDescription>Select the Prime and Project, paste the request email, and/or attach files (PDF, drawing/image, CSV, XLSX). Nothing is sent to AI until you click Analyze.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Prime Contractor *</Label>
              <Select value={primeId} onValueChange={setPrimeId}>
                <SelectTrigger><SelectValue placeholder="Select prime…" /></SelectTrigger>
                <SelectContent>
                  {primes.map((p) => <SelectItem key={p.id} value={p.id}>{p.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId} disabled={!primeId}>
                <SelectTrigger><SelectValue placeholder="Select project…" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Route 66 splice work — week of…" />
          </div>
          <div className="grid gap-2">
            <Label>Pasted Email / Request Text</Label>
            <Textarea value={pastedText} onChange={(e) => setPastedText(e.target.value)} rows={8} placeholder="Paste the prime's request here…" />
          </div>
          <div className="grid gap-2">
            <Label>Attachments</Label>
            <label className="flex items-center gap-2 border border-dashed rounded-lg p-4 cursor-pointer hover:bg-muted/40">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Click to add PDF, image/drawing, CSV or XLSX (max 25MB each)</span>
              <input type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.tiff,.csv,.xlsx,.txt,.eml"
                onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files || [])])} />
            </label>
            {files.length > 0 && (
              <div className="space-y-1">
                {files.map((f, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm bg-muted/40 rounded px-3 py-1.5">
                    <span className="flex items-center gap-2 min-w-0"><FileText className="h-4 w-4 shrink-0" /><span className="truncate">{f.name}</span></span>
                    <button onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => submit(false)} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null} Save Draft
          </Button>
          <Button onClick={() => submit(true)} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />} Analyze with AI
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
