'use client';
import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { formatCents, dollarsToCents, formatCentsToNumber, formatDate } from '@/lib/utils/format';
import { ArrowLeft, Plus, MapPin, CheckCircle, XCircle, Clock, DollarSign, TrendingUp, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { FadeIn } from '@/components/ui/animate';
import dynamic from 'next/dynamic';

const MapViewer = dynamic(() => import('@/components/maps/map-viewer').then(m => m.MapViewer), { ssr: false, loading: () => <div className="h-64 bg-muted animate-pulse rounded-lg" /> });

const statusFlow: Record<string, string[]> = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['UNDER_REVIEW', 'CLOSED'],
  UNDER_REVIEW: ['APPROVED', 'IN_PROGRESS'],
  APPROVED: ['INVOICED', 'CLOSED'],
  INVOICED: ['CLOSED'],
  CLOSED: [],
};

export function JobDetail({ id }: { id: string }) {
  const [job, setJob] = useState<any>(null);
  const [taskTypes, setTaskTypes] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddTask, setShowAddTask] = useState(false);
  const [taskForm, setTaskForm] = useState({ taskTypeId: '', description: '', quantity: '', billingRate: '', workerId: '', workerPayoutRate: '' });

  const fetchJob = useCallback(() => {
    fetch(`/api/jobs/${id}`).then(r => r.json()).then(setJob).catch(console.error);
  }, [id]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/jobs/${id}`).then(r => r.json()),
      fetch('/api/task-types').then(r => r.json()),
      fetch('/api/workers').then(r => r.json()),
    ]).then(([j, tt, w]) => { setJob(j); setTaskTypes(tt ?? []); setWorkers(w ?? []); }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  const handleStatusChange = async (newStatus: string) => {
    try {
      await fetch(`/api/jobs/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) });
      toast.success(`Job status changed to ${newStatus.replace(/_/g, ' ')}`);
      fetchJob();
    } catch { toast.error('Failed to update status'); }
  };

  const handleTaskApprove = async (taskId: string, approve: boolean) => {
    try {
      await fetch(`/api/jobs/${id}/tasks`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, status: approve ? 'APPROVED' : 'REJECTED' }),
      });
      toast.success(`Task ${approve ? 'approved' : 'rejected'}`);
      fetchJob();
    } catch { toast.error('Failed to update task'); }
  };

  const handleAddTask = async () => {
    if (!taskForm.taskTypeId || !taskForm.quantity) return toast.error('Task type and quantity are required');
    try {
      await fetch(`/api/jobs/${id}/tasks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskTypeId: taskForm.taskTypeId,
          description: taskForm.description,
          quantity: parseFloat(taskForm.quantity),
          billingRate: dollarsToCents(parseFloat(taskForm.billingRate || '0')),
          workerId: taskForm.workerId || null,
          workerPayoutRate: dollarsToCents(parseFloat(taskForm.workerPayoutRate || '0')),
        }),
      });
      toast.success('Task added');
      setShowAddTask(false);
      setTaskForm({ taskTypeId: '', description: '', quantity: '', billingRate: '', workerId: '', workerPayoutRate: '' });
      fetchJob();
    } catch { toast.error('Failed to add task'); }
  };

  // Auto-fill rates when task type selected
  const handleTaskTypeSelect = (taskTypeId: string) => {
    setTaskForm(prev => ({ ...prev, taskTypeId }));
    const primeRate = (job?.primeContractor?.rateCards ?? job?.primeContractor?.rates ?? []).find?.((r: any) => r?.taskTypeId === taskTypeId);
    if (primeRate) setTaskForm(prev => ({ ...prev, billingRate: String(formatCentsToNumber(primeRate?.ratePerUnit)) }));
  };

  if (loading) return <div className="p-6"><div className="h-96 bg-muted animate-pulse rounded-lg" /></div>;
  if (!job) return <div className="p-6 text-center text-muted-foreground">Job not found</div>;

  const tasks = job?.tasks ?? [];
  const totalBillable = tasks.reduce((s: number, t: any) => s + (t?.billableAmount ?? 0), 0);
  const totalCost = tasks.reduce((s: number, t: any) => s + (t?.costAmount ?? 0), 0);
  const totalProfit = totalBillable - totalCost;
  const margin = totalBillable > 0 ? (totalProfit / totalBillable) * 100 : 0;
  const nextStatuses = statusFlow[job?.status ?? ''] ?? [];

  const markers = [
    ...(job?.latitude && job?.longitude ? [{ lat: job.latitude, lng: job.longitude, label: 'Job Location' }] : []),
    ...(job?.activityLogs ?? []).filter((l: any) => l?.latitude && l?.longitude).map((l: any) => ({
      lat: l.latitude, lng: l.longitude, label: `${l?.activityType ?? ''} - ${l?.worker?.name ?? 'Worker'}${l?.proximityWarning ? ' ⚠️' : ''}`,
    })),
  ];

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/jobs"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-display font-bold tracking-tight">{job?.jobName ?? ''}</h1>
                <StatusBadge status={job?.status} />
              </div>
              <p className="text-muted-foreground font-mono text-sm">{job?.jobNumber ?? ''} · {job?.primeContractor?.companyName ?? ''}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {nextStatuses.map((s: string) => (
              <Button key={s} variant={s === 'APPROVED' ? 'default' : 'outline'} size="sm" onClick={() => handleStatusChange(s)}>
                {s?.replace(/_/g, ' ') ?? ''}
              </Button>
            ))}
          </div>
        </div>
      </FadeIn>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Billable', value: formatCents(totalBillable), icon: DollarSign, color: 'text-blue-600 bg-blue-50' },
          { label: 'Total Cost', value: formatCents(totalCost), icon: DollarSign, color: 'text-red-600 bg-red-50' },
          { label: 'Gross Profit', value: formatCents(totalProfit), icon: TrendingUp, color: 'text-green-600 bg-green-50' },
          { label: 'Margin', value: `${margin.toFixed(1)}%`, icon: TrendingUp, color: 'text-indigo-600 bg-indigo-50' },
        ].map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <Card key={idx}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${stat.color}`}><Icon className="w-4 h-4" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="text-lg font-bold font-mono">{stat.value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">Tasks ({tasks?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Tasks</CardTitle>
                <Dialog open={showAddTask} onOpenChange={setShowAddTask}>
                  <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 mr-1" />Add Task</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add Task to Job</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <div><Label>Task Type *</Label>
                        <Select value={taskForm.taskTypeId} onValueChange={handleTaskTypeSelect}>
                          <SelectTrigger><SelectValue placeholder="Select task type" /></SelectTrigger>
                          <SelectContent>{(taskTypes ?? []).map((tt: any) => <SelectItem key={tt?.id} value={tt?.id ?? ''}>{tt?.name ?? ''} ({tt?.unitOfMeasure ?? ''})</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div><Label>Description</Label><Input value={taskForm.description} onChange={(e: any) => setTaskForm({...taskForm, description: e.target.value})} /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label>Quantity *</Label><Input type="number" value={taskForm.quantity} onChange={(e: any) => setTaskForm({...taskForm, quantity: e.target.value})} /></div>
                        <div><Label>Billing Rate ($/unit)</Label><Input type="number" step="0.01" value={taskForm.billingRate} onChange={(e: any) => setTaskForm({...taskForm, billingRate: e.target.value})} /></div>
                      </div>
                      <div><Label>Assign Worker</Label>
                        <Select value={taskForm.workerId} onValueChange={(v: string) => setTaskForm({...taskForm, workerId: v})}>
                          <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                          <SelectContent><SelectItem value="none">Unassigned</SelectItem>{(workers ?? []).map((w: any) => <SelectItem key={w?.id} value={w?.id ?? ''}>{w?.name ?? ''}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div><Label>Worker Payout Rate ($/unit)</Label><Input type="number" step="0.01" value={taskForm.workerPayoutRate} onChange={(e: any) => setTaskForm({...taskForm, workerPayoutRate: e.target.value})} /></div>
                      <Button onClick={handleAddTask} className="w-full">Add Task</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task Type</TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Billing</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task: any) => (
                    <TableRow key={task?.id}>
                      <TableCell>
                        <div><p className="font-medium text-sm">{task?.taskType?.name ?? ''}</p><p className="text-xs text-muted-foreground">{task?.description ?? ''}</p></div>
                      </TableCell>
                      <TableCell className="text-sm">{task?.worker?.name ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{task?.quantity ?? 0} {task?.taskType?.unitOfMeasure ?? ''}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCents(task?.billableAmount)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCents(task?.costAmount)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-green-600">{formatCents(task?.profitAmount)}</TableCell>
                      <TableCell><StatusBadge status={task?.status} /></TableCell>
                      <TableCell>
                        {task?.status === 'SUBMITTED' && (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon-sm" onClick={() => handleTaskApprove(task?.id, true)}><CheckCircle className="w-4 h-4 text-green-600" /></Button>
                            <Button variant="ghost" size="icon-sm" onClick={() => handleTaskApprove(task?.id, false)}><XCircle className="w-4 h-4 text-destructive" /></Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Activity Timeline</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {(job?.activityLogs ?? []).map((log: any) => (
                  <div key={log?.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                      {log?.activityType === 'PHOTO' ? '📷' : log?.activityType === 'DOCUMENT' ? '📄' : log?.activityType === 'CHECK_IN' ? '📍' : log?.activityType === 'NOTE' ? '📝' : '🔄'}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{log?.description ?? log?.activityType ?? ''}</p>
                        {log?.proximityWarning && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {log?.worker?.name ?? 'System'} · {formatDate(log?.createdAt)}
                        {log?.distanceFromJob != null ? ` · ${log.distanceFromJob}ft from site` : ''}
                      </p>
                    </div>
                  </div>
                ))}
                {(job?.activityLogs?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground text-center py-4">No activity yet</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="map" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><MapPin className="w-5 h-5 text-primary" />Job Location &amp; Activity Map</CardTitle></CardHeader>
            <CardContent>
              {job?.latitude && job?.longitude ? (
                <MapViewer center={[job.latitude, job.longitude]} markers={markers} className="h-96" />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No GPS coordinates set for this job</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="details" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Job Details</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-muted-foreground">Address</p><p className="font-medium">{[job?.address, job?.city, job?.state, job?.zip].filter(Boolean).join(', ') || '—'}</p></div>
                <div><p className="text-muted-foreground">Contractor</p><p className="font-medium">{job?.primeContractor?.companyName ?? '—'}</p></div>
                <div><p className="text-muted-foreground">Start Date</p><p className="font-medium">{formatDate(job?.startDate)}</p></div>
                <div><p className="text-muted-foreground">Due Date</p><p className="font-medium">{formatDate(job?.dueDate)}</p></div>
                <div><p className="text-muted-foreground">GPS</p><p className="font-mono text-xs">{job?.latitude ? `${job.latitude}, ${job.longitude}` : '—'}</p></div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
