'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from '@/components/ui/dialog';
import { ArrowLeft, Plus, BookOpen, Download, CheckCircle2, Archive, Trash2, Copy, FileSpreadsheet } from 'lucide-react';
import { formatCents } from '@/lib/utils/format';
import Link from 'next/link';
import { toast } from 'sonner';
import { FadeIn } from '@/components/ui/animate';
import { ImportDialog } from './import-dialog';

type PriceBook = {
  id: string; name: string; version: number; status: string; contract?: string | null;
  project?: string | null; market?: string | null; region?: string | null;
  effectiveDate?: string | null; _count?: { lines: number };
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  ARCHIVED: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

export function PriceBooksManager({ primeId }: { primeId: string }) {
  const [prime, setPrime] = useState<any>(null);
  const [books, setBooks] = useState<PriceBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: '', contract: '', project: '', market: '', region: '', effectiveDate: '' });

  const loadBooks = useCallback(async () => {
    const b = await fetch(`/api/price-books?primeId=${primeId}`).then((r) => r.json());
    setBooks(Array.isArray(b) ? b : []);
  }, [primeId]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/prime-contractors/${primeId}`).then((r) => r.json()),
      fetch(`/api/price-books?primeId=${primeId}`).then((r) => r.json()),
    ]).then(([p, b]) => {
      setPrime(p);
      setBooks(Array.isArray(b) ? b : []);
    }).catch(console.error).finally(() => setLoading(false));
  }, [primeId]);

  const loadDetail = useCallback(async (id: string) => {
    const d = await fetch(`/api/price-books/${id}`).then((r) => r.json());
    setSelected(d);
  }, []);

  const handleCreate = async () => {
    if (!form.name) return toast.error('Enter a price book name');
    const res = await fetch('/api/price-books', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primeContractorId: primeId, ...form }),
    });
    if (!res.ok) return toast.error('Failed to create price book');
    const book = await res.json();
    toast.success(`Created "${book.name}" v${book.version} (draft)`);
    setCreateOpen(false);
    setForm({ name: '', contract: '', project: '', market: '', region: '', effectiveDate: '' });
    await loadBooks();
    await loadDetail(book.id);
  };

  const setStatus = async (id: string, status: string) => {
    const res = await fetch(`/api/price-books/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); return toast.error(e.error || 'Failed'); }
    toast.success(status === 'ACTIVE' ? 'Price book activated' : 'Price book archived');
    await loadBooks();
    if (selected?.id === id) await loadDetail(id);
  };

  const deleteBook = async (id: string) => {
    const res = await fetch(`/api/price-books/${id}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json().catch(() => ({})); return toast.error(e.error || 'Failed'); }
    toast.success('Draft deleted');
    if (selected?.id === id) setSelected(null);
    await loadBooks();
  };

  const cloneBook = async (id: string) => {
    const res = await fetch('/api/price-books', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloneFromId: id, primeContractorId: primeId }),
    });
    if (!res.ok) return toast.error('Failed to clone');
    const book = await res.json();
    toast.success(`Cloned to "${book.name}" v${book.version} (draft)`);
    await loadBooks();
    await loadDetail(book.id);
  };

  if (loading) return <div className="p-6"><div className="h-96 bg-muted animate-pulse rounded-lg" /></div>;

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center gap-4">
          <Link href={`/prime-contractors/${primeId}`}><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div className="flex-1">
            <h1 className="text-2xl font-display font-bold tracking-tight">Price Books</h1>
            <p className="text-muted-foreground">{prime?.companyName ?? ''} — rates the prime pays us, versioned. Nothing becomes active until approved.</p>
          </div>
          <div className="flex items-center gap-2">
            <a href="/api/price-books/template"><Button variant="outline"><FileSpreadsheet className="w-4 h-4 mr-2" />Download Template</Button></a>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Price Book</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New Price Book</DialogTitle>
                  <DialogDescription>Creates a new draft. Re-using an existing name creates the next version.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name *</Label><Input value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 2026 Aerial Rates" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Contract</Label><Input value={form.contract} onChange={(e: any) => setForm({ ...form, contract: e.target.value })} /></div>
                    <div><Label>Project</Label><Input value={form.project} onChange={(e: any) => setForm({ ...form, project: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Market</Label><Input value={form.market} onChange={(e: any) => setForm({ ...form, market: e.target.value })} /></div>
                    <div><Label>Region</Label><Input value={form.region} onChange={(e: any) => setForm({ ...form, region: e.target.value })} /></div>
                  </div>
                  <div><Label>Effective Date</Label><Input type="date" value={form.effectiveDate} onChange={(e: any) => setForm({ ...form, effectiveDate: e.target.value })} /></div>
                </div>
                <DialogFooter><Button onClick={handleCreate}>Create Draft</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </FadeIn>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary" />Books</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {books.length === 0 && <p className="text-sm text-muted-foreground">No price books yet.</p>}
            {books.map((b) => (
              <button key={b.id} onClick={() => loadDetail(b.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${selected?.id === b.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{b.name}</span>
                  <Badge className={STATUS_COLORS[b.status]}>{b.status}</Badge>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-muted-foreground font-mono">v{b.version}</span>
                  <span className="text-xs text-muted-foreground">{b._count?.lines ?? 0} lines</span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          {!selected && <Card><CardContent className="p-10 text-center text-muted-foreground">Select a price book to view its lines.</CardContent></Card>}
          {selected && (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">{selected.name} <Badge className={STATUS_COLORS[selected.status]}>{selected.status}</Badge></CardTitle>
                    <p className="text-sm text-muted-foreground mt-1 font-mono">v{selected.version} — {selected.lines?.length ?? 0} lines</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 justify-end">
                    {selected.status === 'DRAFT' && (
                      <ImportDialog primeId={primeId} priceBook={selected} onApproved={() => loadDetail(selected.id)} />
                    )}
                    <a href={`/api/price-books/${selected.id}/export`}><Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" />Export</Button></a>
                    <Button variant="outline" size="sm" onClick={() => cloneBook(selected.id)}><Copy className="w-4 h-4 mr-2" />Clone</Button>
                    {selected.status === 'DRAFT' && (
                      <Button size="sm" onClick={() => setStatus(selected.id, 'ACTIVE')}><CheckCircle2 className="w-4 h-4 mr-2" />Activate</Button>
                    )}
                    {selected.status === 'ACTIVE' && (
                      <Button variant="outline" size="sm" onClick={() => setStatus(selected.id, 'ARCHIVED')}><Archive className="w-4 h-4 mr-2" />Archive</Button>
                    )}
                    {selected.status === 'DRAFT' && (selected.lines?.length ?? 0) === 0 && (
                      <Button variant="ghost" size="sm" onClick={() => deleteBook(selected.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {(selected.lines?.length ?? 0) === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">
                    No lines yet. {selected.status === 'DRAFT' ? 'Use Import to upload a price list.' : ''}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground border-b">
                          <th className="py-2 pr-3">Job Code</th><th className="py-2 pr-3">Description</th>
                          <th className="py-2 pr-3">Unit</th><th className="py-2 pr-3 text-right">Rate</th><th className="py-2 pr-3">Category</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.lines.map((l: any) => (
                          <tr key={l.id} className="border-b last:border-0">
                            <td className="py-2 pr-3 font-mono font-medium">{l.jobCode}</td>
                            <td className="py-2 pr-3">{l.description}</td>
                            <td className="py-2 pr-3 text-muted-foreground">{l.unit}</td>
                            <td className="py-2 pr-3 text-right font-mono text-green-600">{formatCents(l.ratePerUnit)}</td>
                            <td className="py-2 pr-3 text-muted-foreground">{l.category ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
