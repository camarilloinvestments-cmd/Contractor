'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FolderKanban, Plus, ArrowLeft, Save, BookOpen, Layers, Settings2 } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import Link from 'next/link';
import { toast } from 'sonner';
import { FadeIn } from '@/components/ui/animate';

type Project = {
  id: string;
  projectCode: string;
  projectName?: string | null;
  description?: string | null;
  status?: string | null;
  defaultPriceBookId?: string | null;
  defaultPriceBookVersionId?: string | null;
  defaultPriceBook?: { id: string; name: string } | null;
  defaultPriceBookVersion?: { id: string; version: number; label?: string | null; status?: string | null } | null;
  _count?: { jobs?: number; priceBooks?: number };
};

export function ProjectsManager({ primeId }: { primeId: string }) {
  const [prime, setPrime] = useState<any>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ projectCode: '', projectName: '', description: '' });

  // default-config dialog state
  const [configFor, setConfigFor] = useState<Project | null>(null);
  const [cfgBookId, setCfgBookId] = useState<string>('');
  const [cfgVersionId, setCfgVersionId] = useState<string>('');
  const [cfgVersions, setCfgVersions] = useState<any[]>([]);

  const fetchData = useCallback(() => {
    Promise.all([
      fetch(`/api/prime-contractors/${primeId}`).then((r) => r.json()),
      fetch(`/api/projects?primeId=${primeId}`).then((r) => r.json()),
      fetch(`/api/price-books?primeId=${primeId}`).then((r) => r.json()),
    ])
      .then(([p, proj, bks]) => {
        setPrime(p);
        setProjects(Array.isArray(proj) ? proj : []);
        setBooks(Array.isArray(bks) ? bks : []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [primeId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!form.projectCode.trim()) return toast.error('Project code is required');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primeContractorId: primeId, projectCode: form.projectCode.trim(), projectName: form.projectName || null, description: form.description || null }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || 'Failed'); }
      toast.success('Project created');
      setShowCreate(false);
      setForm({ projectCode: '', projectName: '', description: '' });
      fetchData();
    } catch (e: any) { toast.error(e?.message || 'Failed to create project'); }
  };

  const openConfig = async (p: Project) => {
    setConfigFor(p);
    setCfgBookId(p.defaultPriceBookId || '');
    setCfgVersionId(p.defaultPriceBookVersionId || '');
    setCfgVersions([]);
    if (p.defaultPriceBookId) {
      const v = await fetch(`/api/price-books/${p.defaultPriceBookId}/versions`).then((r) => r.json()).catch(() => []);
      setCfgVersions(Array.isArray(v) ? v : []);
    }
  };

  const onCfgBookChange = async (bookId: string) => {
    const id = bookId === '__none__' ? '' : bookId;
    setCfgBookId(id);
    setCfgVersionId('');
    if (id) {
      const v = await fetch(`/api/price-books/${id}/versions`).then((r) => r.json()).catch(() => []);
      setCfgVersions(Array.isArray(v) ? v : []);
    } else {
      setCfgVersions([]);
    }
  };

  const saveConfig = async () => {
    if (!configFor) return;
    try {
      const res = await fetch(`/api/projects/${configFor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setDefaults', defaultPriceBookId: cfgBookId || null, defaultPriceBookVersionId: cfgVersionId || null }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || 'Failed'); }
      toast.success('Project defaults saved');
      setConfigFor(null);
      fetchData();
    } catch (e: any) { toast.error(e?.message || 'Failed to save defaults'); }
  };

  if (loading) return <div className="p-6"><div className="h-96 bg-muted animate-pulse rounded-lg" /></div>;

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center gap-4">
          <Link href={`/prime-contractors/${primeId}`}><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div className="flex-1">
            <h1 className="text-2xl font-display font-bold tracking-tight">Projects</h1>
            <p className="text-muted-foreground">{prime?.companyName ?? ''} · first-class projects &amp; work-order defaults</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Project</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Project Code *</Label><Input value={form.projectCode} onChange={(e: any) => setForm({ ...form, projectCode: e.target.value })} placeholder="e.g. FL-ARCADIA" /></div>
                <div><Label>Project Name</Label><Input value={form.projectName} onChange={(e: any) => setForm({ ...form, projectName: e.target.value })} /></div>
                <div><Label>Description</Label><Textarea value={form.description} onChange={(e: any) => setForm({ ...form, description: e.target.value })} rows={3} /></div>
                <p className="text-xs text-muted-foreground">Project codes are unique within this prime contractor. Set the default price book &amp; version after creating.</p>
                <Button onClick={handleCreate} className="w-full">Create Project</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </FadeIn>

      {projects.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <FolderKanban className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No projects yet for this prime contractor.</p>
          <p className="text-sm">Create a project to enable work-order defaults (price book &amp; version).</p>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {projects.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <FolderKanban className="w-5 h-5 text-primary" />
                      <span className="font-mono">{p.projectCode}</span>
                    </CardTitle>
                    {p.projectName ? <p className="text-sm text-muted-foreground mt-1">{p.projectName}</p> : null}
                  </div>
                  <StatusBadge status={p.status || 'ACTIVE'} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {p.description ? <p className="text-sm text-muted-foreground">{p.description}</p> : null}
                <div className="rounded-lg bg-muted/50 p-3 space-y-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Default Price Book:</span>
                    <span className="font-medium">{p.defaultPriceBook?.name ?? <span className="text-amber-600">Not set</span>}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Default Version:</span>
                    <span className="font-medium font-mono">
                      {p.defaultPriceBookVersion ? `v${p.defaultPriceBookVersion.version}${p.defaultPriceBookVersion.label ? ` · ${p.defaultPriceBookVersion.label}` : ''}` : <span className="text-amber-600">Not set</span>}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{p._count?.jobs ?? 0} work orders</span>
                  <Button variant="outline" size="sm" onClick={() => openConfig(p)}>
                    <Settings2 className="w-4 h-4 mr-2" />Configure Defaults
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!configFor} onOpenChange={(o: boolean) => { if (!o) setConfigFor(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Configure Work-Order Defaults</DialogTitle></DialogHeader>
          {configFor ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Project <span className="font-mono font-medium">{configFor.projectCode}</span>. New work orders for this project pin the selected price book &amp; version. Leaving the version blank pins the book&apos;s active version at creation time.
              </p>
              <div>
                <Label>Default Price Book</Label>
                <Select value={cfgBookId || '__none__'} onValueChange={onCfgBookChange}>
                  <SelectTrigger><SelectValue placeholder="Select price book" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {books.map((b: any) => <SelectItem key={b?.id} value={b?.id ?? ''}>{b?.name ?? ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Default Version {cfgBookId ? '' : '(select a book first)'}</Label>
                <Select value={cfgVersionId || '__active__'} onValueChange={(v: string) => setCfgVersionId(v === '__active__' ? '' : v)} disabled={!cfgBookId}>
                  <SelectTrigger><SelectValue placeholder="Active version at creation" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__active__">Active version at creation time</SelectItem>
                    {cfgVersions.map((v: any) => (
                      <SelectItem key={v?.id} value={v?.id ?? ''}>
                        v{v?.version}{v?.label ? ` · ${v.label}` : ''} — {v?.status} ({v?._count?.lines ?? 0} lines)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={saveConfig} className="w-full"><Save className="w-4 h-4 mr-2" />Save Defaults</Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
