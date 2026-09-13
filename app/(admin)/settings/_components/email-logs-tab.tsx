'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

type Log = { id: string; to: string; subject: string; status: string; error?: string | null; templateKey?: string | null; relatedType?: string | null; createdAt: string };

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'SENT') return 'default';
  if (s === 'FAILED') return 'destructive';
  return 'secondary';
}

export function EmailLogsTab() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch('/api/email-logs?take=100')
      .then((r) => r.json())
      .then((d) => setLogs(d.logs ?? []))
      .catch(() => toast.error('Failed to load logs'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Email Delivery Log</CardTitle>
          <CardDescription>Recent outbound email attempts and their delivery status.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No email activity yet.</TableCell></TableRow>
            )}
            {logs.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-mono text-xs whitespace-nowrap">{new Date(l.createdAt).toLocaleString('en-US', { timeZone: 'UTC' })}</TableCell>
                <TableCell className="text-sm">{l.to}</TableCell>
                <TableCell className="text-sm max-w-xs truncate">{l.subject}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{l.templateKey || l.relatedType || '—'}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(l.status)}>{l.status}</Badge>
                  {l.status === 'FAILED' && l.error && <div className="text-xs text-destructive mt-1 max-w-xs truncate" title={l.error}>{l.error}</div>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
