'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Users, Plus, Shield, MoreHorizontal, KeyRound, Copy } from 'lucide-react';
import { formatDate } from '@/lib/utils/format';
import { FadeIn } from '@/components/ui/animate';
import { toast } from 'sonner';

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  PROJECT_MANAGER: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  FIELD_WORKER: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
};
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  DEACTIVATED: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  LOCKED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

export function UsersContent({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'FIELD_WORKER', workerId: '' });

  // Edit dialog
  const [editUser, setEditUser] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: '' });

  // Reset-password dialog
  const [resetUser, setResetUser] = useState<any | null>(null);
  const [resetMode, setResetMode] = useState<'generate' | 'manual'>('generate');
  const [resetPw, setResetPw] = useState('');
  const [resetForce, setResetForce] = useState(true);
  const [generatedPw, setGeneratedPw] = useState<string | null>(null);

  // Confirm dialog (deactivate / reactivate / revoke / force / delete)
  const [confirm, setConfirm] = useState<{ user: any; action: string; title: string; desc: string; danger?: boolean } | null>(null);

  // Audit dialog
  const [auditUser, setAuditUser] = useState<any | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

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
      if (form.workerId && form.workerId !== 'none') data.workerId = form.workerId;
      const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!res.ok) { const d = await res.json(); throw new Error(d?.error); }
      toast.success('User created');
      setShowCreate(false);
      setForm({ name: '', email: '', password: '', role: 'FIELD_WORKER', workerId: '' });
      fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Failed to create user'); }
  };

  const openEdit = (u: any) => { setEditUser(u); setEditForm({ name: u.name ?? '', email: u.email ?? '', role: u.role ?? '' }); };
  const saveEdit = async () => {
    if (!editUser) return;
    try {
      const res = await fetch(`/api/users/${editUser.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm) });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error);
      toast.success('User updated');
      setEditUser(null);
      fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Failed to update user'); }
  };

  const openReset = (u: any) => { setResetUser(u); setResetMode('generate'); setResetPw(''); setResetForce(true); setGeneratedPw(null); };
  const doReset = async () => {
    if (!resetUser) return;
    if (resetMode === 'manual' && resetPw.length < 8) return toast.error('Password must be at least 8 characters');
    try {
      const body: any = { action: 'reset-password', forceChange: resetForce };
      if (resetMode === 'manual') body.newPassword = resetPw;
      const res = await fetch(`/api/users/${resetUser.id}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error);
      if (d.generatedPassword) { setGeneratedPw(d.generatedPassword); }
      else { toast.success('Password reset'); setResetUser(null); }
      fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Failed to reset password'); }
  };

  const runAction = async (u: any, action: string, successMsg: string) => {
    try {
      const res = await fetch(`/api/users/${u.id}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error);
      toast.success(successMsg);
      fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Action failed'); }
  };
  const doDelete = async (u: any) => {
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error);
      toast.success('User deleted');
      fetchData();
    } catch (err: any) { toast.error(err?.message ?? 'Failed to delete user'); }
  };

  const confirmRun = async () => {
    if (!confirm) return;
    const { user, action } = confirm;
    setConfirm(null);
    if (action === 'delete') return doDelete(user);
    const msgs: Record<string, string> = {
      deactivate: 'User deactivated', reactivate: 'User reactivated', unlock: 'User unlocked',
      'revoke-sessions': 'Sessions revoked', 'force-password-change': 'Password change required at next login',
      'clear-force-password-change': 'Forced password change cleared',
      'reset-mfa': 'Two-factor authentication reset',
    };
    return runAction(user, action, msgs[action] ?? 'Done');
  };

  const openAudit = async (u: any) => {
    setAuditUser(u); setAuditLogs([]);
    try {
      const res = await fetch(`/api/users/${u.id}/audit`);
      const d = await res.json();
      setAuditLogs(Array.isArray(d) ? d : []);
    } catch { setAuditLogs([]); }
  };

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2"><Users className="w-6 h-6" />Users</h1>
            <p className="text-muted-foreground">Manage user accounts, roles and lifecycle</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Add User</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create User Account</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name *</Label><Input value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>Email *</Label><Input type="email" value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} /></div>
                <div><Label>Password *</Label><Input type="password" value={form.password} onChange={(e: any) => setForm({ ...form, password: e.target.value })} /></div>
                <div><Label>Role</Label>
                  <Select value={form.role} onValueChange={(v: string) => setForm({ ...form, role: v })}>
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
                    <Select value={form.workerId} onValueChange={(v: string) => setForm({ ...form, workerId: v })}>
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
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead>
              <TableHead>Status</TableHead><TableHead>2FA</TableHead><TableHead>Last Login</TableHead><TableHead className="w-10"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(users ?? []).map((u: any) => {
                const isSelf = u.id === currentUserId;
                return (
                <TableRow key={u?.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-muted-foreground" />{u?.name ?? ''}
                      {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                      {u?.forcePasswordChange && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">pw reset</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u?.email ?? ''}</TableCell>
                  <TableCell><span className={`px-2 py-1 rounded text-xs font-medium ${ROLE_COLORS[u?.role ?? ''] ?? ''}`}>{u?.role?.replace(/_/g, ' ') ?? ''}</span></TableCell>
                  <TableCell><span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[u?.status ?? 'ACTIVE'] ?? ''}`}>{(u?.status ?? 'ACTIVE')}</span></TableCell>
                  <TableCell>
                    {u?.mfaEnabled
                      ? <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">Enrolled</span>
                      : <span className="px-2 py-1 rounded text-xs font-medium bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">Not enrolled</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u?.lastLoginAt ? formatDate(u.lastLoginAt) : '—'}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onClick={() => openEdit(u)}>Edit profile & role</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openReset(u)}>Reset password</DropdownMenuItem>
                        {u?.forcePasswordChange
                          ? <DropdownMenuItem onClick={() => setConfirm({ user: u, action: 'clear-force-password-change', title: 'Clear forced password change?', desc: 'The user will no longer be required to change their password at next login.' })}>Clear forced pw change</DropdownMenuItem>
                          : <DropdownMenuItem onClick={() => setConfirm({ user: u, action: 'force-password-change', title: 'Require password change?', desc: 'The user will be forced to set a new password at their next login.' })}>Require pw change</DropdownMenuItem>}
                        <DropdownMenuItem onClick={() => setConfirm({ user: u, action: 'revoke-sessions', title: 'Revoke all sessions?', desc: 'The user will be signed out of all devices immediately.' })}>Revoke sessions</DropdownMenuItem>
                        {u?.mfaEnabled && <DropdownMenuItem className="text-red-600" onClick={() => setConfirm({ user: u, action: 'reset-mfa', title: 'Reset two-factor authentication?', desc: 'This removes the user’s authenticator and recovery codes. If 2FA is required for their role, they will be prompted to set it up again at next login.', danger: true })}>Reset 2FA</DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        {u?.status === 'ACTIVE'
                          ? <DropdownMenuItem className="text-red-600" disabled={isSelf} onClick={() => setConfirm({ user: u, action: 'deactivate', title: 'Deactivate user?', desc: 'The account will be blocked from signing in and all sessions revoked.', danger: true })}>Deactivate</DropdownMenuItem>
                          : <DropdownMenuItem onClick={() => setConfirm({ user: u, action: u?.status === 'LOCKED' ? 'unlock' : 'reactivate', title: 'Reactivate user?', desc: 'The account will be able to sign in again.' })}>{u?.status === 'LOCKED' ? 'Unlock' : 'Reactivate'}</DropdownMenuItem>}
                        <DropdownMenuItem onClick={() => openAudit(u)}>View audit history</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-red-600" disabled={isSelf} onClick={() => setConfirm({ user: u, action: 'delete', title: 'Delete user permanently?', desc: 'This cannot be undone. Consider deactivating instead to preserve history.', danger: true })}>Delete user</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );})}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={editForm.name} onChange={(e: any) => setEditForm({ ...editForm, name: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" value={editForm.email} onChange={(e: any) => setEditForm({ ...editForm, email: e.target.value })} /></div>
            <div><Label>Role</Label>
              <Select value={editForm.role} onValueChange={(v: string) => setEditForm({ ...editForm, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="PROJECT_MANAGER">Project Manager</SelectItem>
                  <SelectItem value="FIELD_WORKER">Field Worker</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={saveEdit}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!resetUser} onOpenChange={(o) => !o && setResetUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><KeyRound className="w-4 h-4" />Reset Password</DialogTitle></DialogHeader>
          {generatedPw ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Share this temporary password with the user securely. It will not be shown again.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-sm break-all">{generatedPw}</code>
                <Button variant="outline" size="icon" onClick={() => { navigator.clipboard?.writeText(generatedPw); toast.success('Copied'); }}><Copy className="w-4 h-4" /></Button>
              </div>
              <DialogFooter><Button onClick={() => setResetUser(null)}>Done</Button></DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <div><Label>Method</Label>
                <Select value={resetMode} onValueChange={(v: any) => setResetMode(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="generate">Generate a temporary password</SelectItem>
                    <SelectItem value="manual">Set a specific password</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {resetMode === 'manual' && (
                <div><Label>New Password</Label><Input type="password" value={resetPw} onChange={(e: any) => setResetPw(e.target.value)} placeholder="At least 8 characters" /></div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={resetForce} onChange={(e) => setResetForce(e.target.checked)} />
                Require the user to change it at next login
              </label>
              <DialogFooter>
                <Button variant="outline" onClick={() => setResetUser(null)}>Cancel</Button>
                <Button onClick={doReset}>Reset password</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Audit history dialog */}
      <Dialog open={!!auditUser} onOpenChange={(o) => !o && setAuditUser(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Audit History — {auditUser?.name}</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {auditLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No audit records for this user yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>By</TableHead></TableRow></TableHeader>
                <TableBody>
                  {auditLogs.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{formatDate(l.createdAt)}</TableCell>
                      <TableCell className="font-mono text-xs">{l.action}</TableCell>
                      <TableCell className="text-muted-foreground">{l.actorEmail ?? 'system'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className={confirm?.danger ? 'bg-red-600 hover:bg-red-700' : ''} onClick={confirmRun}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
