'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Plus, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import Link from 'next/link';
import { FadeIn, Stagger, StaggerItem, HoverLift } from '@/components/ui/animate';
import { toast } from 'sonner';

export function PrimeContractorsContent() {
  const [contractors, setContractors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ companyName: '', contactName: '', email: '', phone: '', address: '', city: '', state: '', zip: '' });

  const fetchData = () => {
    fetch('/api/prime-contractors').then(r => r.json()).then(setContractors).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    if (!form.companyName) return toast.error('Company name is required');
    try {
      const res = await fetch('/api/prime-contractors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error();
      toast.success('Contractor created');
      setShowCreate(false);
      setForm({ companyName: '', contactName: '', email: '', phone: '', address: '', city: '', state: '', zip: '' });
      fetchData();
    } catch { toast.error('Failed to create contractor'); }
  };

  const filtered = (contractors ?? []).filter((c: any) =>
    (c?.companyName ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight">Prime Contractors</h1>
            <p className="text-muted-foreground">Manage your customers and their billing rate cards</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />Add Contractor</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Prime Contractor</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Company Name *</Label><Input value={form.companyName} onChange={(e: any) => setForm({...form, companyName: e.target.value})} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Contact Name</Label><Input value={form.contactName} onChange={(e: any) => setForm({...form, contactName: e.target.value})} /></div>
                  <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e: any) => setForm({...form, email: e.target.value})} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Phone</Label><Input value={form.phone} onChange={(e: any) => setForm({...form, phone: e.target.value})} /></div>
                  <div><Label>Address</Label><Input value={form.address} onChange={(e: any) => setForm({...form, address: e.target.value})} /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>City</Label><Input value={form.city} onChange={(e: any) => setForm({...form, city: e.target.value})} /></div>
                  <div><Label>State</Label><Input value={form.state} onChange={(e: any) => setForm({...form, state: e.target.value})} /></div>
                  <div><Label>ZIP</Label><Input value={form.zip} onChange={(e: any) => setForm({...form, zip: e.target.value})} /></div>
                </div>
                <Button onClick={handleCreate} className="w-full">Create Contractor</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </FadeIn>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search contractors..." value={search} onChange={(e: any) => setSearch(e.target.value)} className="pl-10" />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-40 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : (
        <Stagger staggerDelay={0.05}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((c: any) => (
              <StaggerItem key={c?.id}>
                <HoverLift>
                  <Link href={`/prime-contractors/${c?.id}`}>
                    <Card className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Building2 className="w-5 h-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold truncate">{c?.companyName ?? ''}</h3>
                            <p className="text-sm text-muted-foreground">{c?.contactName ?? 'No contact'}</p>
                            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                              <span>{c?._count?.jobs ?? 0} jobs</span>
                              <span>{c?._count?.rateCards ?? 0} rates</span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </HoverLift>
              </StaggerItem>
            ))}
          </div>
        </Stagger>
      )}
    </div>
  );
}
