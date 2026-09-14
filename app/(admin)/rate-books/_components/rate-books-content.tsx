'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Coins, Plus, Users, Home, Info } from 'lucide-react';
import { FadeIn } from '@/components/ui/animate';
import { toast } from 'sonner';
import { formatCents, formatDate } from '@/lib/utils/format';

type Worker = { id: string; name: string; workerType: string; companyName?: string | null };
type SubRate = {
  id: string; workerId: string; jobCode: string; description?: string | null; unit?: string | null;
  ratePerUnit: number; version: number; status: string; effectiveDate?: string | null; notes?: string | null;
  createdAt: string; worker?: { id: string; name: string; workerType: string } | null;
};
type InRate = {
  id: string; jobCode: string; description?: string | null; unit?: string | null;
  ratePerUnit: number; version: number; status: string; effectiveDate?: string | null; notes?: string | null;
  createdAt: string;
};

const emptyForm = { jobCode: '', description: '', unit: '', rate: '', effectiveDate: '', notes: '' };

export function RateBooksContent() {
  const [tab, setTab] = useState('subcontractor');
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [subRates, setSubRates] = useState<SubRate[]>([]);
  const [inRates, setInRates] = useState<InRate[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<string>('');
  const [subForm, setSubForm] = useState({ ...emptyForm });
  const [inForm, setInForm] = useState({ ...emptyForm });
  const [savingSub, setSavingSub] = useState(false);
  const [savingIn, setSavingIn] = useState(false);

  const loadWorkers = () => {
    fetch('/api/workers').then(r => r.json()).then((data: any) => {
      const subs = (Array.isArray(data) ? data : []).filter((w: Worker) => w.workerType === 'SUBCONTRACTOR');
      setWorkers(subs);
    }).catch(console.error);
  };
  const loadSubRates = (workerId?: string) => {
    const q = workerId ? `?workerId=${encodeURIComponent(workerId)}` : '';
    fetch(`/api/subcontractor-rates${q}`).then(r => r.json()).then((d: any) => setSubRates(Array.isArray(d) ? d : [])).catch(console.error);
  };
  const loadInRates = () => {
    fetch('/api/inhouse-rates').then(r => r.json()).then((d: any) => setInRates(Array.isArray(d) ? d : [])).catch(console.error);
  };

  useEffect(() => { loadWorkers(); loadInRates(); }, []);
  useEffect(() => { loadSubRates(selectedWorker || undefined); }, [selectedWorker]);

  const addSubRate = async () => {
    if (!selectedWorker) return toast.error('Select a subcontractor first');
    if (!subForm.jobCode || !subForm.rate) return toast.error('Job code and rate are required');
    setSavingSub(true);
    try {
      const res = await fetch('/api/subcontractor-rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...subForm, workerId: selectedWorker }),
      });
      if (!res.ok) throw new Error();
      toast.success('Rate saved as new version');
      setSubForm({ ...emptyForm });
      loadSubRates(selectedWorker);
    } catch { toast.error('Failed to save rate'); } finally { setSavingSub(false); }
  };

  const addInRate = async () => {
    if (!inForm.jobCode || !inForm.rate) return toast.error('Job code and rate are required');
    setSavingIn(true);
    try {
      const res = await fetch('/api/inhouse-rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...inForm }),
      });
      if (!res.ok) throw new Error();
      toast.success('Rate saved as new version');
      setInForm({ ...emptyForm });
      loadInRates();
    } catch { toast.error('Failed to save rate'); } finally { setSavingIn(false); }
  };

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Coins className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight">Rate Books</h1>
            <p className="text-muted-foreground">Internal cost rates &mdash; what we pay subcontractors and in-house crews</p>
          </div>
        </div>
      </FadeIn>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 p-3 text-sm">
        <Info className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
        <p className="text-amber-800 dark:text-amber-300">
          These are <strong>internal cost rates</strong> and are never exposed on client-facing exports. Saving a rate creates a
          <strong> new version</strong> &mdash; it never overwrites an existing rate, and jobs already in progress retain the rate
          that was active when work was recorded.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="subcontractor"><Users className="w-4 h-4 mr-2" />Subcontractor Rates</TabsTrigger>
          <TabsTrigger value="inhouse"><Home className="w-4 h-4 mr-2" />In-House Rates</TabsTrigger>
        </TabsList>

        <TabsContent value="subcontractor" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add / Update Subcontractor Rate</CardTitle>
              <CardDescription>Select a subcontractor, then add a job-code rate. A new version is created each time.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Subcontractor *</Label>
                  <Select value={selectedWorker} onValueChange={setSelectedWorker}>
                    <SelectTrigger><SelectValue placeholder="Select a subcontractor" /></SelectTrigger>
                    <SelectContent>
                      {workers.map(w => (
                        <SelectItem key={w.id} value={w.id}>{w.name}{w.companyName ? ` \u2014 ${w.companyName}` : ''}</SelectItem>
                      ))}
                      {workers.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No subcontractors found</div>}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-5">
                <div><Label>Job Code *</Label><Input value={subForm.jobCode} onChange={(e: any) => setSubForm({ ...subForm, jobCode: e.target.value })} placeholder="e.g. SPL-001" /></div>
                <div className="md:col-span-2"><Label>Description</Label><Input value={subForm.description} onChange={(e: any) => setSubForm({ ...subForm, description: e.target.value })} placeholder="e.g. Single-mode splice" /></div>
                <div><Label>Unit</Label><Input value={subForm.unit} onChange={(e: any) => setSubForm({ ...subForm, unit: e.target.value })} placeholder="each, ft, hr" /></div>
                <div><Label>Rate (USD) *</Label><Input type="number" step="0.01" value={subForm.rate} onChange={(e: any) => setSubForm({ ...subForm, rate: e.target.value })} placeholder="0.00" /></div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div><Label>Effective Date</Label><Input type="date" value={subForm.effectiveDate} onChange={(e: any) => setSubForm({ ...subForm, effectiveDate: e.target.value })} /></div>
                <div><Label>Notes</Label><Input value={subForm.notes} onChange={(e: any) => setSubForm({ ...subForm, notes: e.target.value })} /></div>
              </div>
              <Button onClick={addSubRate} disabled={savingSub}><Plus className="w-4 h-4 mr-2" />{savingSub ? 'Saving...' : 'Save Rate Version'}</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Rate History{selectedWorker ? '' : ' (all subcontractors)'}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    {!selectedWorker && <TableHead>Subcontractor</TableHead>}
                    <TableHead>Job Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Effective</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subRates.map(r => (
                    <TableRow key={r.id} className={r.status !== 'ACTIVE' ? 'opacity-60' : ''}>
                      {!selectedWorker && <TableCell>{r.worker?.name ?? '\u2014'}</TableCell>}
                      <TableCell className="font-mono text-xs">{r.jobCode}</TableCell>
                      <TableCell>{r.description ?? '\u2014'}</TableCell>
                      <TableCell>{r.unit ?? '\u2014'}</TableCell>
                      <TableCell className="text-right font-mono">{formatCents(r.ratePerUnit)}</TableCell>
                      <TableCell>v{r.version}</TableCell>
                      <TableCell><Badge variant={r.status === 'ACTIVE' ? 'default' : 'secondary'}>{r.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.effectiveDate ? formatDate(r.effectiveDate) : formatDate(r.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                  {subRates.length === 0 && (
                    <TableRow><TableCell colSpan={selectedWorker ? 7 : 8} className="text-center text-muted-foreground py-8">No rates recorded yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inhouse" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add / Update In-House Rate</CardTitle>
              <CardDescription>Internal cost rate for in-house crews by job code. A new version is created each time.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-5">
                <div><Label>Job Code *</Label><Input value={inForm.jobCode} onChange={(e: any) => setInForm({ ...inForm, jobCode: e.target.value })} placeholder="e.g. SPL-001" /></div>
                <div className="md:col-span-2"><Label>Description</Label><Input value={inForm.description} onChange={(e: any) => setInForm({ ...inForm, description: e.target.value })} placeholder="e.g. Single-mode splice" /></div>
                <div><Label>Unit</Label><Input value={inForm.unit} onChange={(e: any) => setInForm({ ...inForm, unit: e.target.value })} placeholder="each, ft, hr" /></div>
                <div><Label>Rate (USD) *</Label><Input type="number" step="0.01" value={inForm.rate} onChange={(e: any) => setInForm({ ...inForm, rate: e.target.value })} placeholder="0.00" /></div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div><Label>Effective Date</Label><Input type="date" value={inForm.effectiveDate} onChange={(e: any) => setInForm({ ...inForm, effectiveDate: e.target.value })} /></div>
                <div><Label>Notes</Label><Input value={inForm.notes} onChange={(e: any) => setInForm({ ...inForm, notes: e.target.value })} /></div>
              </div>
              <Button onClick={addInRate} disabled={savingIn}><Plus className="w-4 h-4 mr-2" />{savingIn ? 'Saving...' : 'Save Rate Version'}</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Rate History</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Effective</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inRates.map(r => (
                    <TableRow key={r.id} className={r.status !== 'ACTIVE' ? 'opacity-60' : ''}>
                      <TableCell className="font-mono text-xs">{r.jobCode}</TableCell>
                      <TableCell>{r.description ?? '\u2014'}</TableCell>
                      <TableCell>{r.unit ?? '\u2014'}</TableCell>
                      <TableCell className="text-right font-mono">{formatCents(r.ratePerUnit)}</TableCell>
                      <TableCell>v{r.version}</TableCell>
                      <TableCell><Badge variant={r.status === 'ACTIVE' ? 'default' : 'secondary'}>{r.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.effectiveDate ? formatDate(r.effectiveDate) : formatDate(r.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                  {inRates.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No rates recorded yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
