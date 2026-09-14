'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, KeyRound, Copy, Trash2, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils/format';

const ALL_SCOPES = ['jobs:read', 'invoices:read', 'payments:read', 'payments:write', '*'];

export function ApiTab() {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['jobs:read']);
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = () => fetch('/api/api-keys').then((r) => r.json()).then((d) => setKeys(d.keys || [])).catch(() => toast.error('Failed to load API keys')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const toggleScope = (sc: string) => setScopes((p) => p.includes(sc) ? p.filter((x) => x !== sc) : [...p, sc]);

  const create = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, scopes, expiresAt: expiresAt || undefined }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Create failed');
      setNewKey(d.plaintextKey);
      setName(''); setScopes(['jobs:read']); setExpiresAt('');
      await load();
      toast.success('API key created');
    } catch (e: any) { toast.error(e.message || 'Create failed'); } finally { setCreating(false); }
  };

  const revoke = async (id: string) => {
    try {
      const res = await fetch(`/api/api-keys/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revoke' }) });
      if (!res.ok) throw new Error();
      await load(); toast.success('Key revoked');
    } catch { toast.error('Revoke failed'); }
  };

  return (
    <div className="space-y-6">
      <Alert><BookOpen className="w-4 h-4" /><AlertTitle>Versioned API</AlertTitle>
        <AlertDescription>Base path <code>/api/v1</code>. Authenticate with <code>Authorization: Bearer &lt;key&gt;</code>. OpenAPI: <a className="underline" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">/api/v1/openapi.json</a>. Financial writes require an <code>Idempotency-Key</code> header.</AlertDescription></Alert>

      {newKey && (
        <Alert>
          <KeyRound className="w-4 h-4" /><AlertTitle>Copy your new key now — it will not be shown again</AlertTitle>
          <AlertDescription>
            <div className="mt-2 flex items-center gap-2">
              <code className="font-mono text-xs break-all bg-muted px-2 py-1 rounded">{newKey}</code>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(newKey); toast.success('Copied'); }}><Copy className="w-3 h-3 mr-1" />Copy</Button>
              <Button size="sm" variant="ghost" onClick={() => setNewKey(null)}>Dismiss</Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader><CardTitle>Create API Key</CardTitle><CardDescription>Only the SHA-256 hash is stored. The plaintext key is shown once.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="kn">Name</Label><Input id="kn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mobile app / Integration" /></div>
            <div><Label htmlFor="exp">Expiration (optional)</Label><Input id="exp" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div>
          </div>
          <div>
            <Label>Scopes</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {ALL_SCOPES.map((sc) => (
                <button key={sc} type="button" onClick={() => toggleScope(sc)}
                  className={`px-3 py-1 rounded-full text-xs border ${scopes.includes(sc) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground'}`}>{sc}</button>
              ))}
            </div>
          </div>
          <Button onClick={create} disabled={creating}>{creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}Create Key</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>API Keys</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div> : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No API keys yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Prefix</TableHead><TableHead>Scopes</TableHead><TableHead>Status</TableHead><TableHead>Last Used</TableHead><TableHead>Source IP</TableHead><TableHead>Expires</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell className="font-mono text-xs">{k.keyPrefix}…</TableCell>
                    <TableCell className="text-xs">{(k.scopes || []).join(', ') || '—'}</TableCell>
                    <TableCell>{k.status === 'ACTIVE' ? <Badge>Active</Badge> : <Badge variant="secondary">Revoked</Badge>}</TableCell>
                    <TableCell className="text-xs">{k.lastUsedAt ? formatDate(k.lastUsedAt) : '—'}</TableCell>
                    <TableCell className="text-xs">{k.lastUsedIp || '—'}</TableCell>
                    <TableCell className="text-xs">{k.expiresAt ? formatDate(k.expiresAt) : 'Never'}</TableCell>
                    <TableCell>{k.status === 'ACTIVE' && <Button size="sm" variant="ghost" onClick={() => revoke(k.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
