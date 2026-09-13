'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { formatCents } from '@/lib/utils/format';
import { BarChart3 } from 'lucide-react';
import { FadeIn } from '@/components/ui/animate';
import dynamic from 'next/dynamic';

const ReportCharts = dynamic(() => import('./report-charts').then(m => m.ReportCharts), { ssr: false });

export function ReportsContent() {
  const [byJob, setByJob] = useState<any[]>([]);
  const [byContractor, setByContractor] = useState<any[]>([]);
  const [byWorker, setByWorker] = useState<any[]>([]);
  const [tab, setTab] = useState('by-job');

  useEffect(() => {
    fetch(`/api/reports?type=${tab}`).then(r => r.json()).then((data: any[]) => {
      if (tab === 'by-job') setByJob(data ?? []);
      else if (tab === 'by-contractor') setByContractor(data ?? []);
      else setByWorker(data ?? []);
    }).catch(console.error);
  }, [tab]);

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground">Profit, loss, and productivity analysis</p>
        </div>
      </FadeIn>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="by-job">By Job</TabsTrigger>
          <TabsTrigger value="by-contractor">By Contractor</TabsTrigger>
          <TabsTrigger value="by-worker">By Worker</TabsTrigger>
        </TabsList>

        <TabsContent value="by-job" className="mt-4 space-y-4">
          <ReportCharts data={byJob} type="job" />
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Contractor</TableHead><TableHead className="text-right">Billable</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(byJob ?? []).map((r: any) => (
                    <TableRow key={r?.id}>
                      <TableCell><p className="font-medium">{r?.jobName ?? ''}</p><p className="text-xs text-muted-foreground font-mono">{r?.jobNumber ?? ''}</p></TableCell>
                      <TableCell>{r?.primeContractor ?? ''}</TableCell>
                      <TableCell className="text-right font-mono">{formatCents(r?.billable)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCents(r?.cost)}</TableCell>
                      <TableCell className="text-right font-mono text-green-600">{formatCents(r?.profit)}</TableCell>
                      <TableCell className="text-right font-mono">{(r?.margin ?? 0).toFixed(1)}%</TableCell>
                      <TableCell><StatusBadge status={r?.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by-contractor" className="mt-4 space-y-4">
          <ReportCharts data={byContractor} type="contractor" />
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader><TableRow><TableHead>Contractor</TableHead><TableHead className="text-right">Jobs</TableHead><TableHead className="text-right">Billable</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(byContractor ?? []).map((r: any) => (
                    <TableRow key={r?.id}>
                      <TableCell className="font-medium">{r?.companyName ?? ''}</TableCell>
                      <TableCell className="text-right font-mono">{r?.jobCount ?? 0}</TableCell>
                      <TableCell className="text-right font-mono">{formatCents(r?.billable)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCents(r?.cost)}</TableCell>
                      <TableCell className="text-right font-mono text-green-600">{formatCents(r?.profit)}</TableCell>
                      <TableCell className="text-right font-mono">{(r?.margin ?? 0).toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by-worker" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader><TableRow><TableHead>Worker</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Total Tasks</TableHead><TableHead className="text-right">Completed</TableHead><TableHead className="text-right">Total Payout</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(byWorker ?? []).map((r: any) => (
                    <TableRow key={r?.id}>
                      <TableCell className="font-medium">{r?.name ?? ''}</TableCell>
                      <TableCell><StatusBadge status={r?.workerType} /></TableCell>
                      <TableCell className="text-right font-mono">{r?.totalTasks ?? 0}</TableCell>
                      <TableCell className="text-right font-mono">{r?.completedTasks ?? 0}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{formatCents(r?.totalPayout)}</TableCell>
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
