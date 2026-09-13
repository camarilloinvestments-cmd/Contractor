'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

type Template = { key: string; name: string; subject: string; bodyHtml: string; bodyText?: string | null; isActive?: boolean; isDefault?: boolean };

export function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = () => {
    fetch('/api/email-templates')
      .then((r) => r.json())
      .then((d) => {
        setTemplates(d.templates ?? []);
        setAllowed(d.allowedVariables ?? []);
        if (!selected && d.templates?.length) {
          setSelected(d.templates[0].key);
          setDraft({ ...d.templates[0] });
        }
      })
      .catch(() => toast.error('Failed to load templates'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const pick = (t: Template) => { setSelected(t.key); setDraft({ ...t }); };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/email-templates/${draft.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'save failed');
      }
      toast.success('Template saved');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground p-6"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <Card className="lg:col-span-1">
        <CardHeader><CardTitle className="text-base">Templates</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {templates.map((t) => (
            <button
              key={t.key}
              onClick={() => pick(t)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${selected === t.key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            >
              <div className="font-medium">{t.name}</div>
              <div className={`text-xs ${selected === t.key ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{t.key}</div>
            </button>
          ))}
        </CardContent>
      </Card>
      <div className="lg:col-span-3 space-y-6">
        {draft ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">{draft.name}{draft.isDefault && <Badge variant="secondary">default</Badge>}</CardTitle>
              <CardDescription>Only allow-listed variables render. Unknown variables are rejected on save.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1"><Label>Subject</Label><Input value={draft.subject ?? ''} onChange={(e: any) => setDraft({ ...draft, subject: e.target.value })} /></div>
              <div className="space-y-1"><Label>HTML Body</Label><Textarea rows={10} className="font-mono text-xs" value={draft.bodyHtml ?? ''} onChange={(e: any) => setDraft({ ...draft, bodyHtml: e.target.value })} /></div>
              <div className="space-y-1"><Label>Plain Text Body</Label><Textarea rows={5} className="font-mono text-xs" value={draft.bodyText ?? ''} onChange={(e: any) => setDraft({ ...draft, bodyText: e.target.value })} /></div>
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save Template
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card><CardContent className="p-6 text-muted-foreground">Select a template to edit.</CardContent></Card>
        )}
        <Card>
          <CardHeader><CardTitle className="text-base">Available Variables</CardTitle><CardDescription>Insert as <code>{'{{variable}}'}</code>. Any other token is rejected.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {allowed.map((v) => (
              <code key={v} className="bg-muted px-2 py-1 rounded text-xs">{`{{${v}}}`}</code>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
