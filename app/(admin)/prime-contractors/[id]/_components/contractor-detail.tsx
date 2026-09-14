'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Save, Plus, Trash2, ArrowLeft, BookOpen, FolderKanban } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { formatCents, dollarsToCents, formatCentsToNumber } from '@/lib/utils/format';
import Link from 'next/link';
import { toast } from 'sonner';
import { FadeIn } from '@/components/ui/animate';

export function ContractorDetail({ id }: { id: string }) {
  const [contractor, setContractor] = useState<any>(null);
  const [taskTypes, setTaskTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<any>({});
  const [newRate, setNewRate] = useState({ taskTypeId: '', rate: '' });

  useEffect(() => {
    Promise.all([
      fetch(`/api/prime-contractors/${id}`).then(r => r.json()),
      fetch('/api/task-types').then(r => r.json()),
    ]).then(([c, tt]) => {
      setContractor(c);
      setForm({ companyName: c?.companyName ?? '', contactName: c?.contactName ?? '', email: c?.email ?? '', phone: c?.phone ?? '', address: c?.address ?? '', city: c?.city ?? '', state: c?.state ?? '', zip: c?.zip ?? '' });
      setTaskTypes(tt ?? []);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    try {
      await fetch(`/api/prime-contractors/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      toast.success('Contractor updated');
    } catch { toast.error('Failed to update'); }
  };

  const handleAddRate = async () => {
    if (!newRate.taskTypeId || !newRate.rate) return toast.error('Select a task type and enter a rate');
    try {
      await fetch(`/api/prime-contractors/${id}/rates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTypeId: newRate.taskTypeId, ratePerUnit: dollarsToCents(parseFloat(newRate.rate)) }),
      });
      toast.success('Rate added');
      setNewRate({ taskTypeId: '', rate: '' });
      const c = await fetch(`/api/prime-contractors/${id}`).then(r => r.json());
      setContractor(c);
    } catch { toast.error('Failed to add rate'); }
  };

  const handleDeleteRate = async (taskTypeId: string) => {
    try {
      await fetch(`/api/prime-contractors/${id}/rates?taskTypeId=${taskTypeId}`, { method: 'DELETE' });
      toast.success('Rate removed');
      const c = await fetch(`/api/prime-contractors/${id}`).then(r => r.json());
      setContractor(c);
    } catch { toast.error('Failed to remove rate'); }
  };

  if (loading) return <div className="p-6"><div className="h-96 bg-muted animate-pulse rounded-lg" /></div>;

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center gap-4">
          <Link href="/prime-contractors"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div className="flex-1">
            <h1 className="text-2xl font-display font-bold tracking-tight">{contractor?.companyName ?? ''}</h1>
            <p className="text-muted-foreground">Prime Contractor Details &amp; Rate Card</p>
          </div>
          <Link href={`/prime-contractors/${id}/projects`}>
            <Button variant="outline"><FolderKanban className="w-4 h-4 mr-2" />Projects</Button>
          </Link>
          <Link href={`/prime-contractors/${id}/price-books`}>
            <Button variant="outline"><BookOpen className="w-4 h-4 mr-2" />Price Books</Button>
          </Link>
        </div>
      </FadeIn>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5 text-primary" />Contact Information</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Company Name</Label><Input value={form.companyName ?? ''} onChange={(e: any) => setForm({...form, companyName: e.target.value})} /></div>
              <div><Label>Contact Name</Label><Input value={form.contactName ?? ''} onChange={(e: any) => setForm({...form, contactName: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input value={form.email ?? ''} onChange={(e: any) => setForm({...form, email: e.target.value})} /></div>
              <div><Label>Phone</Label><Input value={form.phone ?? ''} onChange={(e: any) => setForm({...form, phone: e.target.value})} /></div>
            </div>
            <div><Label>Address</Label><Input value={form.address ?? ''} onChange={(e: any) => setForm({...form, address: e.target.value})} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>City</Label><Input value={form.city ?? ''} onChange={(e: any) => setForm({...form, city: e.target.value})} /></div>
              <div><Label>State</Label><Input value={form.state ?? ''} onChange={(e: any) => setForm({...form, state: e.target.value})} /></div>
              <div><Label>ZIP</Label><Input value={form.zip ?? ''} onChange={(e: any) => setForm({...form, zip: e.target.value})} /></div>
            </div>
            <Button onClick={handleSave}><Save className="w-4 h-4 mr-2" />Save Changes</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Rate Card</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(contractor?.rateCards ?? []).map((rc: any) => (
                <div key={rc?.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">{rc?.taskType?.name ?? ''}</p>
                    <p className="text-xs text-muted-foreground">{rc?.taskType?.unitOfMeasure ?? ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-green-600">{formatCents(rc?.ratePerUnit ?? 0)}</span>
                    <span className="text-xs text-muted-foreground">/{rc?.taskType?.unitOfMeasure ?? ''}</span>
                    <Button variant="ghost" size="icon-sm" onClick={() => handleDeleteRate(rc?.taskTypeId)}>
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="border-t pt-3 space-y-2">
                <p className="text-sm font-medium">Add Rate</p>
                <div className="flex gap-2">
                  <Select value={newRate.taskTypeId} onValueChange={(v: string) => setNewRate({...newRate, taskTypeId: v})}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Task Type" /></SelectTrigger>
                    <SelectContent>
                      {(taskTypes ?? []).map((tt: any) => <SelectItem key={tt?.id} value={tt?.id ?? ''}>{tt?.name ?? ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" placeholder="$/unit" value={newRate.rate} onChange={(e: any) => setNewRate({...newRate, rate: e.target.value})} className="w-28" />
                  <Button onClick={handleAddRate} size="icon"><Plus className="w-4 h-4" /></Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {(contractor?.jobs?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle>Jobs</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(contractor?.jobs ?? []).map((j: any) => (
                <Link key={j?.id} href={`/jobs/${j?.id}`} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <div>
                    <p className="font-medium text-sm">{j?.jobName ?? ''}</p>
                    <p className="text-xs text-muted-foreground font-mono">{j?.jobNumber ?? ''}</p>
                  </div>
                  <StatusBadge status={j?.status} />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
