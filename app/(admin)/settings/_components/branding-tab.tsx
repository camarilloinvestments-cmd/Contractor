'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save, Upload, ImageIcon, X } from 'lucide-react';
import { toast } from 'sonner';

type Profile = Record<string, any>;

const FIELDS: { key: string; label: string; placeholder?: string; type?: string }[] = [
  { key: 'companyName', label: 'Company Name *', placeholder: 'OS1 Fiber Track Pro' },
  { key: 'legalName', label: 'Legal Name' },
  { key: 'tagline', label: 'Tagline', placeholder: 'Fiber Construction Services' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'ZIP' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Website' },
  { key: 'supportEmail', label: 'Support Email' },
  { key: 'supportPhone', label: 'Support Phone' },
  { key: 'invoicePrefix', label: 'Invoice Prefix', placeholder: 'INV' },
  { key: 'portalUrl', label: 'Portal URL' },
];

export function BrandingTab() {
  const [profile, setProfile] = useState<Profile>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch('/api/settings/branding')
      .then((r) => r.json())
      .then((d) => setProfile(d ?? {}))
      .catch(() => toast.error('Failed to load branding'))
      .finally(() => setLoading(false));
  }, []);

  const set = (k: string, v: string) => setProfile((p) => ({ ...p, [k]: v }));

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/settings/branding/logo', { method: 'POST', body: fd });
      const pj = await res.json();
      if (!res.ok) throw new Error(pj?.error || 'Upload failed');
      setProfile((p) => ({
        ...p,
        logoUrl: pj.logoUrl,
        logoStoragePath: pj.logoStoragePath,
        logoContentType: pj.logoContentType,
      }));
      toast.success('Logo uploaded — click Save Branding to apply');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to upload logo');
    } finally {
      setUploading(false);
    }
  };

  const clearLogo = async () => {
    try {
      const res = await fetch('/api/settings/branding/logo', { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Failed to remove logo');
      }
      setProfile((p) => ({ ...p, logoUrl: '', logoStoragePath: '', logoContentType: '' }));
      toast.success('Logo removed');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to remove logo');
    }
  };

  const save = async () => {
    if (!profile.companyName || String(profile.companyName).trim().length === 0) {
      return toast.error('Company name is required');
    }
    setSaving(true);
    try {
      const res = await fetch('/api/settings/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      if (!res.ok) throw new Error('save failed');
      setProfile(await res.json());
      toast.success('Branding saved');
    } catch {
      toast.error('Failed to save branding');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground p-6"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company Branding</CardTitle>
        <CardDescription>Controls the company name, contact details, colors, and invoice identity across the app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-lg border p-4">
          <Label>Company Logo</Label>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
              {profile.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.logoUrl} alt="Company logo" className="h-full w-full object-contain" />
              ) : (
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  id="logo-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="hidden"
                  onChange={(e: any) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ''; }}
                />
                <Button type="button" variant="outline" size="sm" disabled={uploading}
                  onClick={() => document.getElementById('logo-upload')?.click()}>
                  {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Upload Logo
                </Button>
                {profile.logoUrl ? (
                  <Button type="button" variant="ghost" size="sm" onClick={clearLogo}>
                    <X className="mr-1 h-4 w-4" />Remove
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">PNG, JPG, WEBP, GIF, or SVG. Used across the app, invoices, and closeout deliverables.</p>
              <Input value={profile.logoUrl ?? ''} placeholder="… or paste an external logo URL"
                onChange={(e: any) => set('logoUrl', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label>{f.label}</Label>
              <Input value={profile[f.key] ?? ''} placeholder={f.placeholder} onChange={(e: any) => set(f.key, e.target.value)} />
            </div>
          ))}
          <div className="space-y-1">
            <Label>Primary Color</Label>
            <div className="flex items-center gap-2">
              <Input type="color" className="w-16 p-1 h-10" value={profile.primaryColor || '#1466d4'} onChange={(e: any) => set('primaryColor', e.target.value)} />
              <Input value={profile.primaryColor ?? ''} placeholder="#1466d4" onChange={(e: any) => set('primaryColor', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Accent Color</Label>
            <div className="flex items-center gap-2">
              <Input type="color" className="w-16 p-1 h-10" value={profile.accentColor || '#0bbad4'} onChange={(e: any) => set('accentColor', e.target.value)} />
              <Input value={profile.accentColor ?? ''} placeholder="#0bbad4" onChange={(e: any) => set('accentColor', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Invoice Footer</Label>
          <Textarea rows={2} value={profile.invoiceFooter ?? ''} onChange={(e: any) => set('invoiceFooter', e.target.value)} placeholder="Thank you for your business." />
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save Branding
        </Button>
      </CardContent>
    </Card>
  );
}
