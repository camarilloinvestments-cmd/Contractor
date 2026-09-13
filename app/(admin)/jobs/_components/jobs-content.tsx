'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Briefcase, Plus, Search, Filter } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { formatDate } from '@/lib/utils/format';
import Link from 'next/link';
import { FadeIn, Stagger, StaggerItem, HoverLift } from '@/components/ui/animate';
import { toast } from 'sonner';

const statuses = ['', 'DRAFT', 'ACTIVE', 'IN_PROGRESS', 'UNDER_REVIEW', 'APPROVED', 'INVOICED', 'CLOSED'];

export function JobsContent() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [contractors, setContractors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ jobName: '', primeContractorId: '', address: '', city: '', state: '', zip: '', latitude: '', longitude: '' });

  const fetchData = () => {
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    Promise.all([
      fetch(`/api/jobs${qs}`).then(r => r.json()),
      fetch('/api/prime-contractors').then(r => r.json()),
    ]).then(([j, c]) => { setJobs(j ?? []); setContractors(c ?? []); }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [statusFilter]);

  const handleCreate = async () => {
    if (!form.jobName || !form.primeContractorId) return toast.error('Job name and contractor are required');
    try {
      const data: any = { jobName: form.jobName, primeContractorId: form.primeContractorId, address: form.address, city: form.city, state: form.state, zip: form.zip };
      if (form.latitude) data.latitude = parseFloat(form.latitude);
      if (form.longitude) data.longitude = parseFloat(form.longitude);
      const res = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error();
      toast.success('Job created');
      setShowCreate(false);
      setForm({ jobName: '', primeContractorId: '', address: '', city: '', state: '', zip: '', latitude: '', longitude: '' });
      fetchData();
    } catch { toast.error('Failed to create job'); }
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
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Create Job</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Job / Work Order</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Job Name *</Label><Input value={form.jobName} onChange={(e: any) => setForm({...form, jobName: e.target.value})} /></div>
                <div><Label>Prime Contractor *</Label>
                  <Select value={form.primeContractorId} onValueChange={(v: string) => setForm({...form, primeContractorId: v})}>
                    <SelectTrigger><SelectValue placeholder="Select contractor" /></SelectTrigger>
                    <SelectContent>{(contractors ?? []).map((c: any) => <SelectItem key={c?.id} value={c?.id ?? ''}>{c?.companyName ?? ''}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
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
                <Button onClick={handleCreate} className="w-full">Create Job</Button>
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
                            <p className="text-sm text-muted-foreground">{job?.primeContractor?.companyName ?? ''} · {job?._count?.tasks ?? 0} tasks</p>
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
