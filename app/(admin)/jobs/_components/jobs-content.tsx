'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Briefcase, Plus, Search, Filter, BookOpen, Layers, AlertTriangle } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { formatDate } from '@/lib/utils/format';
import Link from 'next/link';
import { FadeIn, Stagger, StaggerItem, HoverLift } from '@/components/ui/animate';
import { toast } from 'sonner';

const statuses = ['', 'DRAFT', 'ACTIVE', 'IN_PROGRESS', 'UNDER_REVIEW', 'APPROVED', 'INVOICED', 'CLOSED'];

const EMPTY_FORM = { jobName: '', primeContractorId: '', projectId: '', address: '', city: '', state: '', zip: '', latitude: '', longitude: '' };

export function JobsContent() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [contractors, setContractors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // cascade state
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [overrideVersionId, setOverrideVersionId] = useState<string>(''); // '' = use project default
  const [submitting, setSubmitting] = useState(false);

  const fetchData = () => {
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    Promise.all([
      fetch(`/api/jobs${qs}`).then(r => r.json()),
      fetch('/api/prime-contractors').then(r => r.json()),
    ]).then(([j, c]) => { setJobs(j ?? []); setContractors(c ?? []); }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [statusFilter]);

  const resetCreate = () => {
    setForm({ ...EMPTY_FORM });
    setProjects([]);
    setSelectedProject(null);
    setVersions([]);
    setOverrideVersionId('');
  };

  // Prime changed -> load its projects, clear downstream.
  const onPrimeChange = async (primeContractorId: string) => {
    setForm({ ...form, primeContractorId, projectId: '' });
    setProjects([]);
    setSelectedProject(null);
    setVersions([]);
    setOverrideVersionId('');
    if (!primeContractorId) return;
    const p = await fetch(`/api/projects?primeId=${primeContractorId}`).then(r => r.json()).catch(() => []);
    setProjects(Array.isArray(p) ? p : []);
  };

  // Project changed -> load full project (defaults) + versions of its default book.
  const onProjectChange = async (projectId: string) => {
    setForm({ ...form, projectId });
    setSelectedProject(null);
    setVersions([]);
    setOverrideVersionId('');
    if (!projectId) return;
    const proj = await fetch(`/api/projects/${projectId}`).then(r => r.json()).catch(() => null);
    setSelectedProject(proj);
    if (proj?.defaultPriceBookId) {
      const v = await fetch(`/api/price-books/${proj.defaultPriceBookId}/versions`).then(r => r.json()).catch(() => []);
      setVersions(Array.isArray(v) ? v : []);
    }
  };

  const hasDefaultBook = !!selectedProject?.defaultPriceBookId;
  const pinnedVersionLabel = (() => {
    if (overrideVersionId) {
      const v = versions.find((x: any) => x?.id === overrideVersionId);
      return v ? `v${v.version}${v.label ? ` · ${v.label}` : ''}` : '';
    }
    if (selectedProject?.defaultPriceBookVersion) {
      const dv = selectedProject.defaultPriceBookVersion;
      return `v${dv.version}${dv.label ? ` · ${dv.label}` : ''} (project default)`;
    }
    return 'Active version at creation time';
  })();

  const handleCreate = async () => {
    if (!form.jobName.trim()) return toast.error('Job name is required');
    if (!form.primeContractorId) return toast.error('Select a prime contractor');
    if (!form.projectId) return toast.error('Select a project');
    if (!hasDefaultBook) return toast.error('This project has no default price book. Configure it under Prime → Projects first.');
    setSubmitting(true);
    try {
      const data: any = {
        jobName: form.jobName.trim(),
        projectId: form.projectId,
        address: form.address, city: form.city, state: form.state, zip: form.zip,
      };
      if (overrideVersionId) data.priceBookVersionId = overrideVersionId;
      if (form.latitude) data.latitude = parseFloat(form.latitude);
      if (form.longitude) data.longitude = parseFloat(form.longitude);
      const res = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || 'Failed'); }
      toast.success('Work order created');
      setShowCreate(false);
      resetCreate();
      fetchData();
    } catch (e: any) { toast.error(e?.message || 'Failed to create job'); }
    finally { setSubmitting(false); }
  };

  const filtered = (jobs ?? []).filter((j: any) => (j?.jobName ?? '').toLowerCase().includes(search.toLowerCase()) || (j?.jobNumber ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight">Jobs / Work Orders</h1>
            <p className="text-muted-foreground">Manage all fiber construction work orders</p>
          </div>
          <Dialog open={showCreate} onOpenChange={(o: boolean) => { setShowCreate(o); if (!o) resetCreate(); }}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Create Work Order</Button></DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New Work Order</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Work Order Name *</Label><Input value={form.jobName} onChange={(e: any) => setForm({...form, jobName: e.target.value})} /></div>

                <div><Label>Prime Contractor *</Label>
                  <Select value={form.primeContractorId} onValueChange={onPrimeChange}>
                    <SelectTrigger><SelectValue placeholder="Select contractor" /></SelectTrigger>
                    <SelectContent>{(contractors ?? []).map((c: any) => <SelectItem key={c?.id} value={c?.id ?? ''}>{c?.companyName ?? ''}</SelectItem>)}</SelectContent>
                  </Select>
                </div>

                <div><Label>Project *</Label>
                  <Select value={form.projectId} onValueChange={onProjectChange} disabled={!form.primeContractorId}>
                    <SelectTrigger><SelectValue placeholder={form.primeContractorId ? 'Select project' : 'Select a prime contractor first'} /></SelectTrigger>
                    <SelectContent>
                      {projects.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">No projects for this prime</div>
                      ) : projects.map((p: any) => (
                        <SelectItem key={p?.id} value={p?.id ?? ''}>
                          {p?.projectCode}{p?.projectName ? ` · ${p.projectName}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedProject && !hasDefaultBook && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>This project has no default price book configured. Set it under <span className="font-medium">Prime → Projects → Configure Defaults</span> before creating a work order.</span>
                  </div>
                )}

                {selectedProject && hasDefaultBook && (
                  <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Price Book:</span>
                      <span className="font-medium">{selectedProject?.defaultPriceBook?.name ?? ''}</span>
                    </div>
                    <div>
                      <Label className="flex items-center gap-2 mb-1"><Layers className="w-4 h-4 text-muted-foreground" />Version to pin</Label>
                      <Select value={overrideVersionId || '__default__'} onValueChange={(v: string) => setOverrideVersionId(v === '__default__' ? '' : v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">Use project default</SelectItem>
                          {versions.map((v: any) => (
                            <SelectItem key={v?.id} value={v?.id ?? ''}>
                              v{v?.version}{v?.label ? ` · ${v.label}` : ''} — {v?.status} ({v?._count?.lines ?? 0} lines)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">Pinned to this work order: <span className="font-mono">{pinnedVersionLabel}</span></p>
                    </div>
                  </div>
                )}

                <div><Label>Address</Label><Input value={form.address} onChange={(e: any) => setForm({...form, address: e.target.value})} /></div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>City</Label><Input value={form.city} onChange={(e: any) => setForm({...form, city: e.target.value})} /></div>
                  <div><Label>State</Label><Input value={form.state} onChange={(e: any) => setForm({...form, state: e.target.value})} /></div>
                  <div><Label>ZIP</Label><Input value={form.zip} onChange={(e: any) => setForm({...form, zip: e.target.value})} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Latitude</Label><Input type="number" step="any" value={form.latitude} onChange={(e: any) => setForm({...form, latitude: e.target.value})} /></div>
                  <div><Label>Longitude</Label><Input type="number" step="any" value={form.longitude} onChange={(e: any) => setForm({...form, longitude: e.target.value})} /></div>
                </div>
                <Button onClick={handleCreate} className="w-full" disabled={submitting || (!!selectedProject && !hasDefaultBook)}>
                  {submitting ? 'Creating…' : 'Create Work Order'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </FadeIn>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search jobs..." value={search} onChange={(e: any) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><Filter className="w-4 h-4 mr-2" /><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {statuses.filter(Boolean).map(s => <SelectItem key={s} value={s}>{s?.replace(/_/g, ' ') ?? ''}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Stagger staggerDelay={0.03}>
        <div className="space-y-3">
          {filtered.map((job: any) => (
            <StaggerItem key={job?.id}>
              <HoverLift>
                <Link href={`/jobs/${job?.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Briefcase className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold">{job?.jobName ?? ''}</h3>
                              <span className="text-xs font-mono text-muted-foreground">{job?.jobNumber ?? ''}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {job?.primeContractor?.companyName ?? ''}
                              {job?.project?.projectCode ? ` · ${job.project.projectCode}` : ''}
                              {` · ${job?._count?.tasks ?? 0} tasks`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-muted-foreground">{formatDate(job?.updatedAt)}</span>
                          <StatusBadge status={job?.status} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </HoverLift>
            </StaggerItem>
          ))}
        </div>
      </Stagger>
    </div>
  );
}
