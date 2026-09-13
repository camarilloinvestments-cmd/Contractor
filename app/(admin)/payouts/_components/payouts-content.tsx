'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { formatCents, formatDate } from '@/lib/utils/format';
import { DollarSign, CreditCard } from 'lucide-react';
import { FadeIn } from '@/components/ui/animate';
import { toast } from 'sonner';

export function PayoutsContent() {
  const [data, setData] = useState<any>({ payouts: [], balances: [] });
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    fetch('/api/payouts').then(r => r.json()).then(setData).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(() => { fetchData(); }, []);

  const handleCreatePayout = async (workerId: string) => {
    try {
      await fetch('/api/payouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId }) });
      toast.success('Payout created');
      fetchData();
    } catch { toast.error('Failed to create payout'); }
  };

  const handleMarkPaid = async (id: string) => {
    try {
      await fetch(`/api/payouts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'PAID' }) });
      toast.success('Payout marked as paid');
      fetchData();
    } catch { toast.error('Failed to update'); }
  };

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Payouts</h1>
          <p className="text-muted-foreground">Manage worker payable balances and payout records</p>
        </div>
      </FadeIn>

      {(data?.balances?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="w-5 h-5 text-primary" />Payable Balances</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Worker</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Tasks</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {(data?.balances ?? []).map((b: any) => (
                  <TableRow key={b?.id}>
                    <TableCell className="font-medium">{b?.name ?? ''}</TableCell>
                    <TableCell><StatusBadge status={b?.workerType} /></TableCell>
                    <TableCell className="text-right font-mono">{b?.taskCount ?? 0}</TableCell>
                    <TableCell className="text-right font-mono font-semibold text-green-600">{formatCents(b?.payableBalance)}</TableCell>
                    <TableCell><Button size="sm" onClick={() => handleCreatePayout(b?.id)}><CreditCard className="w-4 h-4 mr-1" />Create Payout</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Payout History</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Worker</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Tasks</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data?.payouts ?? []).map((p: any) => (
                <TableRow key={p?.id}>
                  <TableCell className="font-medium">{p?.worker?.name ?? ''}</TableCell>
                  <TableCell><StatusBadge status={p?.worker?.workerType} /></TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatCents(p?.totalAmount)}</TableCell>
                  <TableCell className="text-right font-mono">{p?._count?.tasks ?? 0}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(p?.createdAt)}</TableCell>
                  <TableCell><StatusBadge status={p?.status} /></TableCell>
                  <TableCell>
                    {p?.status === 'PENDING' && <Button variant="ghost" size="sm" onClick={() => handleMarkPaid(p?.id)}>Mark Paid</Button>}
                  </TableCell>
                </TableRow>
              ))}
              {(data?.payouts?.length ?? 0) === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No payouts yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
