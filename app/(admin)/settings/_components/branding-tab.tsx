'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

type Profile = Record<string, any>;

const FIELDS: { key: string; label: string; placeholder?: string; type?: string }[] = [
  { key: 'companyName', label: 'Company Name *', placeholder: 'FiberTrack Pro' },
  { key: 'legalName', label: 'Legal Name' },
  { key: 'tagline', label: 'Tagline', placeholder: 'Fiber Construction Services' },
  { key: 'logoUrl', label: 'Logo URL', placeholder: 'https://www.k2-industries.com/cdn/shop/files/W_2_85a5be16-b9bc-4fab-bb78-75143cb1686d.jpg?v=1776907597&width=1214' },
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

  useEffect(() => {
    fetch('/api/settings/branding')
      .then((r) => r.json())
      .then((d) => setProfile(d ?? {}))
      .catch(() => toast.error('Failed to load branding'))
      .finally(() => setLoading(false));
  }, []);

  const set = (k: string, v: string) => setProfile((p) => ({ ...p, [k]: v }));

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
