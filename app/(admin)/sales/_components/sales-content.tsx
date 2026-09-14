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
import { TrendingUp, Plus, Users, Percent, Info, Trash2, Archive } from 'lucide-react';
import { FadeIn } from '@/components/ui/animate';
import { toast } from 'sonner';
import { formatCents, formatDate, dollarsToCents, formatCentsToNumber } from '@/lib/utils/format';

type Salesperson = {
  id: string; name: string; email?: string | null; phone?: string | null; status: string;
  notes?: string | null; createdAt: string;
  _count?: { jobs: number; commissionRecords: number };
};
type Plan = {
  id: string; name: string; planType: string; earnedEvent: string; config: any; status: string;
  version: number; notes?: string | null; createdAt: string;
  _count?: { jobs: number; commissionRecords: number };
};

const PLAN_TYPES: { value: string; label: string }[] = [
  { value: 'PERCENT_REVENUE', label: 'Percent of Revenue' },
  { value: 'PERCENT_GROSS_PROFIT', label: 'Percent of Gross Profit' },
  { value: 'FLAT_PER_JOB', label: 'Flat per Job' },
  { value: 'FLAT_PER_TASK', label: 'Flat per Task' },
  { value: 'PRODUCTION_RATE', label: 'Production Rate (per unit)' },
  { value: 'TIERED', label: 'Tiered (by revenue)' },
];
const EARNED_EVENTS: { value: string; label: string }[] = [
  { value: 'JOB_COMPLETED', label: 'Job Completed' },
  { value: 'JOB_APPROVED', label: 'Job Approved' },
  { value: 'INVOICE_GENERATED', label: 'Invoice Generated' },
  { value: 'INVOICE_PAID', label: 'Invoice Paid' },
];

function planTypeLabel(v: string) { return PLAN_TYPES.find(p => p.value === v)?.label ?? v; }
function earnedEventLabel(v: string) { return EARNED_EVENTS.find(p => p.value === v)?.label ?? v; }

const emptySp = { name: '', email: '', phone: '', notes: '' };
type TierRow = { upTo: string; percent: string };
const emptyPlan = { name: '', planType: 'PERCENT_REVENUE', earnedEvent: 'INVOICE_PAID', notes: '', percent: '', flatAmount: '', flatPerTask: '', ratePerUnit: '' };

export function SalesContent() {
  const [tab, setTab] = useState('salespeople');
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [spForm, setSpForm] = useState({ ...emptySp });
  const [savingSp, setSavingSp] = useState(false);
  const [planForm, setPlanForm] = useState({ ...emptyPlan });
  const [tiers, setTiers] = useState<TierRow[]>([{ upTo: '', percent: '' }]);
  const [savingPlan, setSavingPlan] = useState(false);

  const loadSalespeople = () => {
    fetch('/api/salespeople').then(r => r.json()).then((d: any) => setSalespeople(Array.isArray(d) ? d : [])).catch(console.error);
  };
  const loadPlans = () => {
    fetch('/api/commission-plans').then(r => r.json()).then((d: any) => setPlans(Array.isArray(d) ? d : [])).catch(console.error);
  };
  useEffect(() => { loadSalespeople(); loadPlans(); }, []);

  const addSalesperson = async () => {
    if (!spForm.name.trim()) return toast.error('Name is required');
    setSavingSp(true);
    try {
      const res = await fetch('/api/salespeople', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spForm),
      });
      if (!res.ok) throw new Error();
      toast.success('Salesperson added');
      setSpForm({ ...emptySp });
      loadSalespeople();
    } catch { toast.error('Failed to add salesperson'); } finally { setSavingSp(false); }
  };

  const toggleSpStatus = async (sp: Salesperson) => {
    const next = sp.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const res = await fetch(`/api/salespeople/${sp.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error();
      loadSalespeople();
    } catch { toast.error('Failed to update'); }
  };

  const buildConfig = () => {
    const t = planForm.planType;
    if (t === 'PERCENT_REVENUE' || t === 'PERCENT_GROSS_PROFIT') return { percent: parseFloat(planForm.percent) || 0 };
    if (t === 'FLAT_PER_JOB') return { flatAmount: dollarsToCents(parseFloat(planForm.flatAmount) || 0) };
    if (t === 'FLAT_PER_TASK') return { flatPerTask: dollarsToCents(parseFloat(planForm.flatPerTask) || 0) };
    if (t === 'PRODUCTION_RATE') return { ratePerUnit: dollarsToCents(parseFloat(planForm.ratePerUnit) || 0) };
    if (t === 'TIERED') {
      const cleaned = tiers
        .filter(tr => tr.percent !== '')
        .map(tr => ({ upTo: tr.upTo === '' ? null : dollarsToCents(parseFloat(tr.upTo) || 0), percent: parseFloat(tr.percent) || 0 }));
      return { tiers: cleaned };
    }
    return {};
  };

  const addPlan = async () => {
    if (!planForm.name.trim()) return toast.error('Plan name is required');
    setSavingPlan(true);
    try {
      const res = await fetch('/api/commission-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: planForm.name, planType: planForm.planType, earnedEvent: planForm.earnedEvent, notes: planForm.notes, config: buildConfig() }),
      });
      if (!res.ok) throw new Error();
      toast.success('Compensation plan created');
      setPlanForm({ ...emptyPlan });
      setTiers([{ upTo: '', percent: '' }]);
      loadPlans();
    } catch { toast.error('Failed to create plan'); } finally { setSavingPlan(false); }
  };

  const archivePlan = async (p: Plan) => {
    const next = p.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE';
    try {
      const res = await fetch(`/api/commission-plans/${p.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error();
      loadPlans();
    } catch { toast.error('Failed to update plan'); }
  };

  const configSummary = (p: Plan) => {
    const c = p.config || {};
    switch (p.planType) {
      case 'PERCENT_REVENUE':
      case 'PERCENT_GROSS_PROFIT': return `${c.percent ?? 0}%`;
      case 'FLAT_PER_JOB': return formatCents(c.flatAmount ?? 0);
      case 'FLAT_PER_TASK': return `${formatCents(c.flatPerTask ?? 0)}/task`;
      case 'PRODUCTION_RATE': return `${formatCents(c.ratePerUnit ?? 0)}/unit`;
      case 'TIERED': return `${(c.tiers ?? []).length} tier(s)`;
      default: return '';
    }
  };

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold">Sales &amp; Commissions</h1>
            <p className="text-sm text-muted-foreground">Manage salespeople and internal compensation plans. These are internal costs and never appear on client-facing exports.</p>
          </div>
        </div>
      </FadeIn>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="salespeople"><Users className="h-4 w-4 mr-2" />Salespeople</TabsTrigger>
          <TabsTrigger value="plans"><Percent className="h-4 w-4 mr-2" />Compensation Plans</TabsTrigger>
        </TabsList>

        <TabsContent value="salespeople" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Add Salesperson</CardTitle>
              <CardDescription>Salespeople can be assigned to jobs and linked to a compensation plan.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label>Name *</Label>
                <Input value={spForm.name} onChange={e => setSpForm({ ...spForm, name: e.target.value })} placeholder="Jane Salesrep" />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input value={spForm.email} onChange={e => setSpForm({ ...spForm, email: e.target.value })} placeholder="jane@example.com" />
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input value={spForm.phone} onChange={e => setSpForm({ ...spForm, phone: e.target.value })} placeholder="(555) 555-5555" />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input value={spForm.notes} onChange={e => setSpForm({ ...spForm, notes: e.target.value })} placeholder="Optional" />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <Button onClick={addSalesperson} disabled={savingSp}><Plus className="h-4 w-4 mr-2" />Add Salesperson</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Salespeople</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Jobs</TableHead>
                    <TableHead>Commissions</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salespeople.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No salespeople yet</TableCell></TableRow>
                  )}
                  {salespeople.map(sp => (
                    <TableRow key={sp.id}>
                      <TableCell className="font-medium">{sp.name}{sp.notes ? <div className="text-xs text-muted-foreground">{sp.notes}</div> : null}</TableCell>
                      <TableCell className="text-sm">{sp.email || '—'}{sp.phone ? <div className="text-xs text-muted-foreground">{sp.phone}</div> : null}</TableCell>
                      <TableCell>{sp._count?.jobs ?? 0}</TableCell>
                      <TableCell>{sp._count?.commissionRecords ?? 0}</TableCell>
                      <TableCell><Badge variant={sp.status === 'ACTIVE' ? 'default' : 'secondary'}>{sp.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => toggleSpStatus(sp)}>{sp.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plans" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Create Compensation Plan</CardTitle>
              <CardDescription className="flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Editing a plan later never rewrites past commissions &mdash; every recorded commission snapshots the exact plan &amp; rate used at calculation time.</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Plan Name *</Label>
                <Input value={planForm.name} onChange={e => setPlanForm({ ...planForm, name: e.target.value })} placeholder="Standard 4% of Revenue" />
              </div>
              <div className="space-y-1">
                <Label>Plan Type</Label>
                <Select value={planForm.planType} onValueChange={v => setPlanForm({ ...planForm, planType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PLAN_TYPES.map(pt => <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Earned When</Label>
                <Select value={planForm.earnedEvent} onValueChange={v => setPlanForm({ ...planForm, earnedEvent: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{EARNED_EVENTS.map(ev => <SelectItem key={ev.value} value={ev.value}>{ev.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input value={planForm.notes} onChange={e => setPlanForm({ ...planForm, notes: e.target.value })} placeholder="Optional" />
              </div>

              {(planForm.planType === 'PERCENT_REVENUE' || planForm.planType === 'PERCENT_GROSS_PROFIT') && (
                <div className="space-y-1">
                  <Label>Percent (%)</Label>
                  <Input type="number" step="0.01" value={planForm.percent} onChange={e => setPlanForm({ ...planForm, percent: e.target.value })} placeholder="4" />
                </div>
              )}
              {planForm.planType === 'FLAT_PER_JOB' && (
                <div className="space-y-1">
                  <Label>Flat Amount per Job ($)</Label>
                  <Input type="number" step="0.01" value={planForm.flatAmount} onChange={e => setPlanForm({ ...planForm, flatAmount: e.target.value })} placeholder="50.00" />
                </div>
              )}
              {planForm.planType === 'FLAT_PER_TASK' && (
                <div className="space-y-1">
                  <Label>Flat Amount per Task ($)</Label>
                  <Input type="number" step="0.01" value={planForm.flatPerTask} onChange={e => setPlanForm({ ...planForm, flatPerTask: e.target.value })} placeholder="5.00" />
                </div>
              )}
              {planForm.planType === 'PRODUCTION_RATE' && (
                <div className="space-y-1">
                  <Label>Rate per Unit ($)</Label>
                  <Input type="number" step="0.01" value={planForm.ratePerUnit} onChange={e => setPlanForm({ ...planForm, ratePerUnit: e.target.value })} placeholder="0.25" />
                </div>
              )}
              {planForm.planType === 'TIERED' && (
                <div className="sm:col-span-2 space-y-2">
                  <Label>Revenue Tiers</Label>
                  <p className="text-xs text-muted-foreground">Each band pays its percent on the portion of revenue up to its cap. Leave the cap blank on the final tier for &ldquo;and above&rdquo;.</p>
                  {tiers.map((tr, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input type="number" step="0.01" placeholder="Up to ($) — blank = ∞" value={tr.upTo} onChange={e => setTiers(tiers.map((x, j) => j === i ? { ...x, upTo: e.target.value } : x))} />
                      <Input type="number" step="0.01" placeholder="Percent %" value={tr.percent} onChange={e => setTiers(tiers.map((x, j) => j === i ? { ...x, percent: e.target.value } : x))} />
                      <Button variant="ghost" size="icon" onClick={() => setTiers(tiers.length > 1 ? tiers.filter((_, j) => j !== i) : tiers)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setTiers([...tiers, { upTo: '', percent: '' }])}><Plus className="h-4 w-4 mr-2" />Add Tier</Button>
                </div>
              )}

              <div className="sm:col-span-2">
                <Button onClick={addPlan} disabled={savingPlan}><Plus className="h-4 w-4 mr-2" />Create Plan</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Compensation Plans</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Rate</TableHead>
                    <TableHead>Earned</TableHead><TableHead>Jobs</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No compensation plans yet</TableCell></TableRow>
                  )}
                  {plans.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}{p.notes ? <div className="text-xs text-muted-foreground">{p.notes}</div> : null}</TableCell>
                      <TableCell className="text-sm">{planTypeLabel(p.planType)}</TableCell>
                      <TableCell className="font-mono text-sm">{configSummary(p)}</TableCell>
                      <TableCell className="text-sm">{earnedEventLabel(p.earnedEvent)}</TableCell>
                      <TableCell>{p._count?.jobs ?? 0}</TableCell>
                      <TableCell><Badge variant={p.status === 'ACTIVE' ? 'default' : 'secondary'}>{p.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => archivePlan(p)}><Archive className="h-4 w-4 mr-2" />{p.status === 'ACTIVE' ? 'Archive' : 'Restore'}</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
