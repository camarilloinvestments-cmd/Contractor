'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { FileText, Plus, Download } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { formatCents, formatDate } from '@/lib/utils/format';
import Link from 'next/link';
import { FadeIn } from '@/components/ui/animate';
import { toast } from 'sonner';

export function InvoicesContent() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [contractors, setContractors] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedContractor, setSelectedContractor] = useState('');
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [taxRate, setTaxRate] = useState('0');

  const fetchData = () => {
    Promise.all([
      fetch('/api/invoices').then(r => r.json()),
      fetch('/api/prime-contractors').then(r => r.json()),
    ]).then(([inv, con]) => { setInvoices(inv ?? []); setContractors(con ?? []); }).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (selectedContractor) {
      fetch(`/api/jobs?status=APPROVED&primeContractorId=${selectedContractor}`)
        .then(r => r.json()).then(j => setJobs(j ?? [])).catch(console.error);
    } else {
      setJobs([]);
    }
  }, [selectedContractor]);

  const handleCreate = async () => {
    if (!selectedContractor || selectedJobs.length === 0) return toast.error('Select a contractor and at least one job');
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primeContractorId: selectedContractor, jobIds: selectedJobs, taxRate: parseFloat(taxRate || '0') }),
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data?.error ?? 'Failed'); }
      toast.success('Invoice created');
      setShowCreate(false);
      setSelectedContractor('');
      setSelectedJobs([]);
      fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Failed to create invoice'); }
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await fetch(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      toast.success(`Invoice marked as ${status.toLowerCase()}`);
      fetchData();
    } catch { toast.error('Failed to update'); }
  };

  const handleDownloadPdf = (id: string) => {
    const a = document.createElement('a');
    a.href = `/api/invoices/${id}/pdf`;
    a.download = `invoice-${id}.pdf`;
    a.click();
  };

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight">Invoices</h1>
            <p className="text-muted-foreground">Generate and manage prime contractor invoices</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Create Invoice</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Generate Invoice</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Prime Contractor</Label>
                  <Select value={selectedContractor} onValueChange={setSelectedContractor}>
                    <SelectTrigger><SelectValue placeholder="Select contractor" /></SelectTrigger>
                    <SelectContent>{(contractors ?? []).map((c: any) => <SelectItem key={c?.id} value={c?.id ?? ''}>{c?.companyName ?? ''}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {(jobs?.length ?? 0) > 0 && (
                  <div>
                    <Label>Select Approved Jobs</Label>
                    <div className="space-y-2 mt-2 max-h-48 overflow-y-auto">
                      {(jobs ?? []).map((j: any) => (
                        <label key={j?.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer">
                          <Checkbox
                            checked={selectedJobs.includes(j?.id ?? '')}
                            onCheckedChange={(checked: boolean) => {
                              setSelectedJobs(prev => checked ? [...prev, j?.id ?? ''] : prev.filter((x: string) => x !== j?.id));
                            }}
                          />
                          <span className="text-sm">{j?.jobName ?? ''}</span>
                          <span className="text-xs font-mono text-muted-foreground ml-auto">{j?.jobNumber ?? ''}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div><Label>Tax Rate (%)</Label><Input type="number" step="0.01" value={taxRate} onChange={(e: any) => setTaxRate(e.target.value)} /></div>
                <Button onClick={handleCreate} className="w-full">Generate Invoice</Button>
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
                <TableHead>Invoice #</TableHead>
                <TableHead>Contractor</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invoices ?? []).map((inv: any) => (
                <TableRow key={inv?.id}>
                  <TableCell className="font-mono font-medium">{inv?.invoiceNumber ?? ''}</TableCell>
                  <TableCell>{inv?.primeContractor?.companyName ?? ''}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatCents(inv?.total)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(inv?.createdAt)}</TableCell>
                  <TableCell><StatusBadge status={inv?.status} /></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => handleDownloadPdf(inv?.id)}><Download className="w-4 h-4" /></Button>
                      {inv?.status === 'DRAFT' && <Button variant="ghost" size="sm" onClick={() => handleStatusChange(inv?.id, 'SENT')}>Mark Sent</Button>}
                      {inv?.status === 'SENT' && <Button variant="ghost" size="sm" onClick={() => handleStatusChange(inv?.id, 'PAID')}>Mark Paid</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
