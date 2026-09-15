'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Save, Camera, MapPin, Info } from 'lucide-react';
import { toast } from 'sonner';

type Settings = Record<string, any>;

const OVERLAY_FIELDS: { key: string; label: string }[] = [
  { key: 'showLogo', label: 'Company logo' },
  { key: 'showCompanyName', label: 'Company name' },
  { key: 'showWorkOrder', label: 'Work order number' },
  { key: 'showProject', label: 'Project name' },
  { key: 'showTaskCode', label: 'Task / billing code' },
  { key: 'showTechnician', label: 'Technician name' },
  { key: 'showGpsCoords', label: 'GPS coordinates (lat/lon)' },
  { key: 'showGpsAccuracy', label: 'GPS accuracy' },
  { key: 'showAddress', label: 'Address (if geocoded)' },
  { key: 'showDate', label: 'Capture date' },
  { key: 'showTime', label: 'Capture time' },
  { key: 'showCompassHeading', label: 'Compass heading' },
  { key: 'showPhotoReference', label: 'Photo reference number' },
];

export function WatermarkTab() {
  const [s, setS] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings/watermark')
      .then((r) => r.json())
      .then((d) => setS(d ?? {}))
      .catch(() => toast.error('Failed to load watermark settings'))
      .finally(() => setLoading(false));
  }, []);

  const set = (k: string, v: any) => setS((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/watermark', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      const pj = await res.json();
      if (!res.ok) throw new Error(pj?.error || 'Save failed');
      setS(pj);
      toast.success('Watermark settings saved');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save watermark settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Camera className="w-5 h-5" />Field Photo Watermark</CardTitle>
          <CardDescription>
            Server-side evidence watermarking for field photos. Branding (logo &amp; company name) is
            pulled from your company profile &mdash; there is no separate logo to upload here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label className="text-base">Enable watermarking</Label>
              <p className="text-sm text-muted-foreground">Generate a watermarked derivative for every field photo. The original is always preserved.</p>
            </div>
            <Switch checked={!!s.enabled} onCheckedChange={(v) => set('enabled', v)} />
          </div>

          <div>
            <Label className="text-base">Overlay fields</Label>
            <p className="text-sm text-muted-foreground mb-3">Choose which context appears in the watermark panel.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {OVERLAY_FIELDS.map((f) => (
                <div key={f.key} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-sm">{f.label}</span>
                  <Switch checked={!!s[f.key]} onCheckedChange={(v) => set(f.key, v)} disabled={!s.enabled} />
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Panel position</Label>
              <Select value={s.position || 'BOTTOM'} onValueChange={(v) => set('position', v)} disabled={!s.enabled}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BOTTOM">Bottom</SelectItem>
                  <SelectItem value="TOP">Top</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Panel opacity ({s.opacityPercent ?? 55}%)</Label>
              <Input
                type="number" min={0} max={100}
                value={s.opacityPercent ?? 55}
                onChange={(e) => set('opacityPercent', Number(e.target.value))}
                disabled={!s.enabled}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MapPin className="w-5 h-5" />GPS Location Policy</CardTitle>
          <CardDescription>Control whether field photos require a GPS fix and the accuracy your company accepts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Location policy</Label>
              <Select value={s.gpsPolicy || 'REQUIRED'} onValueChange={(v) => set('gpsPolicy', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="REQUIRED">Required &mdash; block capture without a fix</SelectItem>
                  <SelectItem value="WARN">Warn &mdash; allow but flag missing location</SelectItem>
                  <SelectItem value="OPTIONAL">Optional &mdash; allow silently</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Max acceptable accuracy (meters)</Label>
              <Input
                type="number" min={1} max={1000}
                value={s.maxAccuracyMeters ?? 30}
                onChange={(e) => set('maxAccuracyMeters', Number(e.target.value))}
              />
            </div>
          </div>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Accuracy tiers</AlertTitle>
            <AlertDescription>
              High &le; 10m, Acceptable &le; 30m, Low &gt; 30m. Photos above your max acceptable
              accuracy are flagged for review but the location is never fabricated.
            </AlertDescription>
          </Alert>
          <div className="grid gap-4 sm:grid-cols-2 pt-4">
            <div className="space-y-2">
              <Label>Field timezone (watermark display)</Label>
              <Input
                placeholder="America/Chicago"
                value={(s as any).fieldTimezone ?? 'America/Chicago'}
                onChange={(e) => set('fieldTimezone', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">IANA timezone for watermark date/time. Internal timestamps remain UTC.</p>
            </div>
            <div className="space-y-2">
              <Label>Reverse geocode provider</Label>
              <Select value={(s as any).geocodeProvider || 'nominatim'} onValueChange={(v) => set('geocodeProvider', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nominatim">Nominatim (OpenStreetMap, free)</SelectItem>
                  <SelectItem value="none">None — coordinates only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save Watermark Settings
        </Button>
      </div>
    </div>
  );
}
