'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Wrench, Plus, Edit } from 'lucide-react';
import { FadeIn } from '@/components/ui/animate';
import { toast } from 'sonner';

export function TaskTypesContent() {
  const [taskTypes, setTaskTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', unitOfMeasure: '' });

  const fetchData = () => {
    fetch('/api/task-types').then(r => r.json()).then(setTaskTypes).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    if (!form.name || !form.unitOfMeasure) return toast.error('Name and unit of measure required');
    try {
      await fetch('/api/task-types', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      toast.success('Task type created');
      setShowCreate(false);
      setForm({ name: '', description: '', unitOfMeasure: '' });
      fetchData();
    } catch { toast.error('Failed to create'); }
  };

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight">Task Types</h1>
            <p className="text-muted-foreground">Global catalog of fiber construction task types</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Add Task Type</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Task Type</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name *</Label><Input value={form.name} onChange={(e: any) => setForm({...form, name: e.target.value})} placeholder="e.g. Splice - Single Mode" /></div>
                <div><Label>Description</Label><Input value={form.description} onChange={(e: any) => setForm({...form, description: e.target.value})} /></div>
                <div><Label>Unit of Measure *</Label><Input value={form.unitOfMeasure} onChange={(e: any) => setForm({...form, unitOfMeasure: e.target.value})} placeholder="e.g. each, ft, hr" /></div>
                <Button onClick={handleCreate} className="w-full">Create Task Type</Button>
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
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Unit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(taskTypes ?? []).map((tt: any) => (
                <TableRow key={tt?.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2"><Wrench className="w-4 h-4 text-primary" />{tt?.name ?? ''}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{tt?.description ?? '—'}</TableCell>
                  <TableCell><span className="bg-muted px-2 py-1 rounded text-xs font-mono">{tt?.unitOfMeasure ?? ''}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
