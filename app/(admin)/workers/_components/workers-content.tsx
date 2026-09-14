'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { HardHat, Plus, Search } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import Link from 'next/link';
import { FadeIn, Stagger, StaggerItem, HoverLift } from '@/components/ui/animate';
import { toast } from 'sonner';

export function WorkersContent() {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', workerType: 'SUBCONTRACTOR', email: '', phone: '', companyName: '' });

  const fetchData = () => {
    setLoading(true);
    setError(null);
    fetch('/api/workers')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setWorkers(Array.isArray(data) ? data : (data?.workers ?? [])))
      .catch(() => setError('Unable to load workers. Please retry.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    if (!form.name) return toast.error('Name is required');
    try {
      await fetch('/api/workers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      toast.success('Worker created');
      setShowCreate(false);
      setForm({ name: '', workerType: 'SUBCONTRACTOR', email: '', phone: '', companyName: '' });
      fetchData();
    } catch { toast.error('Failed to create'); }
  };

  const filtered = (workers ?? []).filter((w: any) => (w?.name ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight">Workers</h1>
            <p className="text-muted-foreground">Manage subcontractors and in-house field workers</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Add Worker</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Worker</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name *</Label><Input value={form.name} onChange={(e: any) => setForm({...form, name: e.target.value})} /></div>
                <div><Label>Type</Label>
                  <Select value={form.workerType} onValueChange={(v: string) => setForm({...form, workerType: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SUBCONTRACTOR">Subcontractor</SelectItem>
                      <SelectItem value="IN_HOUSE">In-House</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Email</Label><Input value={form.email} onChange={(e: any) => setForm({...form, email: e.target.value})} /></div>
                  <div><Label>Phone</Label><Input value={form.phone} onChange={(e: any) => setForm({...form, phone: e.target.value})} /></div>
                </div>
                {form.workerType === 'SUBCONTRACTOR' && <div><Label>Company</Label><Input value={form.companyName} onChange={(e: any) => setForm({...form, companyName: e.target.value})} /></div>}
                <Button onClick={handleCreate} className="w-full">Create Worker</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </FadeIn>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search workers..." value={search} onChange={(e: any) => setSearch(e.target.value)} className="pl-10" />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Card key={i}><CardContent className="pt-6"><div className="h-16 animate-pulse rounded-md bg-muted" /></CardContent></Card>
          ))}
        </div>
      ) : error ? (
        <Card><CardContent className="py-12 text-center space-y-3">
          <p className="text-sm font-medium text-destructive">{error}</p>
          <Button variant="outline" onClick={fetchData}>Retry</Button>
        </CardContent></Card>
      ) : (workers ?? []).length === 0 ? (
        <Card><CardContent className="py-12 text-center space-y-2">
          <HardHat className="mx-auto w-8 h-8 text-muted-foreground" />
          <p className="text-sm font-medium">No workers yet</p>
          <p className="text-sm text-muted-foreground">Add your first subcontractor or in-house field worker to get started.</p>
        </CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center space-y-2">
          <Search className="mx-auto w-8 h-8 text-muted-foreground" />
          <p className="text-sm font-medium">No workers match &ldquo;{search}&rdquo;</p>
          <p className="text-sm text-muted-foreground">Try a different search term.</p>
        </CardContent></Card>
      ) : (
      <Stagger staggerDelay={0.05}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((w: any) => (
            <StaggerItem key={w?.id}>
              <HoverLift>
                <Link href={`/workers/${w?.id}`}>
                  <Card className="cursor-pointer hover:shadow-md transition-shadow">
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <HardHat className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold">{w?.name ?? ''}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <StatusBadge status={w?.workerType} />
                            {w?.companyName && <span className="text-xs text-muted-foreground">{w.companyName}</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">{w?._count?.tasks ?? 0} tasks assigned</p>
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
      )}
    </div>
  );
}
