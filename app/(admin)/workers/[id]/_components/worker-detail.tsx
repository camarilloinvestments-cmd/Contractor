'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { formatCents, dollarsToCents, formatCentsToNumber } from '@/lib/utils/format';
import { ArrowLeft, Save, Plus, HardHat, DollarSign } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { FadeIn } from '@/components/ui/animate';

export function WorkerDetail({ id }: { id: string }) {
  const [worker, setWorker] = useState<any>(null);
  const [taskTypes, setTaskTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<any>({});
  const [newRate, setNewRate] = useState({ taskTypeId: '', rate: '' });

  useEffect(() => {
    Promise.all([
      fetch(`/api/workers/${id}`).then(r => r.json()),
      fetch('/api/task-types').then(r => r.json()),
    ]).then(([w, tt]) => {
      setWorker(w);
      setForm({ name: w?.name ?? '', workerType: w?.workerType ?? 'SUBCONTRACTOR', email: w?.email ?? '', phone: w?.phone ?? '', companyName: w?.companyName ?? '' });
      setTaskTypes(tt ?? []);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    try {
      await fetch(`/api/workers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      toast.success('Worker updated');
    } catch { toast.error('Failed to update'); }
  };

  const handleAddRate = async () => {
    if (!newRate.taskTypeId || !newRate.rate) return toast.error('Select a task type and enter a rate');
    try {
      await fetch(`/api/workers/${id}/rates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTypeId: newRate.taskTypeId, ratePerUnit: dollarsToCents(parseFloat(newRate.rate)) }),
      });
      toast.success('Rate added');
      setNewRate({ taskTypeId: '', rate: '' });
      const w = await fetch(`/api/workers/${id}`).then(r => r.json());
      setWorker(w);
    } catch { toast.error('Failed to add rate'); }
  };

  if (loading) return <div className="p-6"><div className="h-96 bg-muted animate-pulse rounded-lg" /></div>;

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center gap-4">
          <Link href="/workers"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight">{worker?.name ?? ''}</h1>
            <div className="flex items-center gap-2"><StatusBadge status={worker?.workerType} />
              <span className="text-sm text-muted-foreground">Payable Balance: <span className="font-mono font-semibold text-green-600">{formatCents(worker?.payableBalance)}</span></span>
            </div>
          </div>
        </div>
      </FadeIn>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><HardHat className="w-5 h-5 text-primary" />Worker Info</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Name</Label><Input value={form.name ?? ''} onChange={(e: any) => setForm({...form, name: e.target.value})} /></div>
              <div><Label>Type</Label>
                <Select value={form.workerType ?? ''} onValueChange={(v: string) => setForm({...form, workerType: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="SUBCONTRACTOR">Subcontractor</SelectItem><SelectItem value="IN_HOUSE">In-House</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input value={form.email ?? ''} onChange={(e: any) => setForm({...form, email: e.target.value})} /></div>
              <div><Label>Phone</Label><Input value={form.phone ?? ''} onChange={(e: any) => setForm({...form, phone: e.target.value})} /></div>
            </div>
            {form.workerType === 'SUBCONTRACTOR' && <div><Label>Company</Label><Input value={form.companyName ?? ''} onChange={(e: any) => setForm({...form, companyName: e.target.value})} /></div>}
            <Button onClick={handleSave}><Save className="w-4 h-4 mr-2" />Save Changes</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="w-5 h-5 text-primary" />Payout Rate Card</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(worker?.rates ?? []).map((r: any) => (
                <div key={r?.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div><p className="font-medium text-sm">{r?.taskType?.name ?? ''}</p><p className="text-xs text-muted-foreground">{r?.taskType?.unitOfMeasure ?? ''}</p></div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-green-600">{formatCents(r?.ratePerUnit)}</span>
                    <span className="text-xs text-muted-foreground">/{r?.taskType?.unitOfMeasure ?? ''}</span>
                  </div>
                </div>
              ))}
              <div className="border-t pt-3 space-y-2">
                <p className="text-sm font-medium">Add Rate</p>
                <div className="flex gap-2">
                  <Select value={newRate.taskTypeId} onValueChange={(v: string) => setNewRate({...newRate, taskTypeId: v})}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Task Type" /></SelectTrigger>
                    <SelectContent>{(taskTypes ?? []).map((tt: any) => <SelectItem key={tt?.id} value={tt?.id ?? ''}>{tt?.name ?? ''}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" placeholder="$/unit" value={newRate.rate} onChange={(e: any) => setNewRate({...newRate, rate: e.target.value})} className="w-28" />
                  <Button onClick={handleAddRate} size="icon"><Plus className="w-4 h-4" /></Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent Tasks</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Task</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Payout</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {(worker?.tasks ?? []).map((t: any) => (
                <TableRow key={t?.id}>
                  <TableCell><Link href={`/jobs/${t?.job?.jobNumber ? '' : ''}${t?.jobId ?? ''}`} className="text-primary hover:underline">{t?.job?.jobName ?? ''}</Link></TableCell>
                  <TableCell>{t?.taskType?.name ?? ''}</TableCell>
                  <TableCell className="text-right font-mono">{t?.quantity ?? 0}</TableCell>
                  <TableCell className="text-right font-mono">{formatCents(t?.costAmount)}</TableCell>
                  <TableCell><StatusBadge status={t?.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
