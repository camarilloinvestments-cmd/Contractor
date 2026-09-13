'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { Users, Plus, Shield } from 'lucide-react';
import { formatDate } from '@/lib/utils/format';
import { FadeIn } from '@/components/ui/animate';
import { toast } from 'sonner';

export function UsersContent() {
  const [users, setUsers] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'FIELD_WORKER', workerId: '' });

  const fetchData = () => {
    Promise.all([
      fetch('/api/users').then(r => r.json()),
      fetch('/api/workers').then(r => r.json()),
    ]).then(([u, w]) => { setUsers(u ?? []); setWorkers(w ?? []); }).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    if (!form.name || !form.email || !form.password) return toast.error('All fields required');
    try {
      const data: any = { name: form.name, email: form.email, password: form.password, role: form.role };
      if (form.workerId) data.workerId = form.workerId;
      const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!res.ok) { const d = await res.json(); throw new Error(d?.error); }
      toast.success('User created');
      setShowCreate(false);
      setForm({ name: '', email: '', password: '', role: 'FIELD_WORKER', workerId: '' });
      fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Failed to create user'); }
  };

  const roleColors: Record<string, string> = {
    ADMIN: 'bg-red-100 text-red-700',
    PROJECT_MANAGER: 'bg-blue-100 text-blue-700',
    FIELD_WORKER: 'bg-green-100 text-green-700',
  };

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight">Users</h1>
            <p className="text-muted-foreground">Manage user accounts and role assignments</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Add User</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create User Account</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name *</Label><Input value={form.name} onChange={(e: any) => setForm({...form, name: e.target.value})} /></div>
                <div><Label>Email *</Label><Input type="email" value={form.email} onChange={(e: any) => setForm({...form, email: e.target.value})} /></div>
                <div><Label>Password *</Label><Input type="password" value={form.password} onChange={(e: any) => setForm({...form, password: e.target.value})} /></div>
                <div><Label>Role</Label>
                  <Select value={form.role} onValueChange={(v: string) => setForm({...form, role: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ADMIN">Admin</SelectItem>
                      <SelectItem value="PROJECT_MANAGER">Project Manager</SelectItem>
                      <SelectItem value="FIELD_WORKER">Field Worker</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.role === 'FIELD_WORKER' && (
                  <div><Label>Link to Worker Profile</Label>
                    <Select value={form.workerId} onValueChange={(v: string) => setForm({...form, workerId: v})}>
                      <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                      <SelectContent><SelectItem value="none">None</SelectItem>{(workers ?? []).filter((w: any) => !w?.user).map((w: any) => <SelectItem key={w?.id} value={w?.id ?? ''}>{w?.name ?? ''}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <Button onClick={handleCreate} className="w-full">Create User</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </FadeIn>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Joined</TableHead></TableRow></TableHeader>
            <TableBody>
              {(users ?? []).map((u: any) => (
                <TableRow key={u?.id}>
                  <TableCell className="font-medium"><div className="flex items-center gap-2"><Shield className="w-4 h-4 text-muted-foreground" />{u?.name ?? ''}</div></TableCell>
                  <TableCell className="text-muted-foreground">{u?.email ?? ''}</TableCell>
                  <TableCell><span className={`px-2 py-1 rounded text-xs font-medium ${roleColors[u?.role ?? ''] ?? ''}`}>{u?.role?.replace(/_/g, ' ') ?? ''}</span></TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(u?.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
