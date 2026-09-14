'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Upload, CheckCircle2, XCircle, Download, Loader2, AlertTriangle } from 'lucide-react';
import { formatCents } from '@/lib/utils/format';
import { toast } from 'sonner';

type Summary = {
  totalRows: number; validRows: number; newItems: number; unchanged: number;
  rateIncreases: number; rateDecreases: number; duplicateJobCodes: number; rowsRequiringCorrection: number;
  changes: { jobCode: string; description: string; unit: string; currentRate: number | null; uploadedRate: number; diff: number | null; kind: string }[];
};

const KIND_STYLE: Record<string, string> = {
  new: 'text-blue-600', increase: 'text-red-600', decrease: 'text-green-600', unchanged: 'text-muted-foreground',
};

export function ImportDialog({ primeId, priceBook, onApproved }: { primeId: string; priceBook: any; onApproved: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [errorCount, setErrorCount] = useState(0);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  const reset = () => { setFile(null); setImportId(null); setSummary(null); setErrorCount(0); };

  const handleUpload = async (useAi: boolean) => {
    if (!file) return toast.error('Choose a file first');
    setParsing(true);
    try {
      let mapping: any = null;
      if (useAi) {
        const fd0 = new FormData();
        fd0.append('file', file);
        const aiRes = await fetch('/api/price-imports/ai-map', { method: 'POST', body: fd0 }).then((r) => r.json());
        setAiConfigured(!!aiRes.aiConfigured);
        mapping = aiRes.mapping ?? null;
        if (!aiRes.aiConfigured) toast.message('AI mapping not configured — used automatic column detection.');
        else if (aiRes.source === 'ai') toast.success('AI suggested a column mapping.');
      }
      const fd = new FormData();
      fd.append('file', file);
      fd.append('primeContractorId', primeId);
      fd.append('priceBookId', priceBook.id);
      fd.append('usedAi', String(useAi && aiConfigured === true));
      if (mapping) fd.append('mapping', JSON.stringify(mapping));
      const res = await fetch('/api/price-imports', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to parse file'); return; }
      setImportId(data.import.id);
      setSummary(data.summary);
      setErrorCount(data.errorCount ?? 0);
      toast.success('Preview ready — review before approving.');
    } catch {
      toast.error('Failed to parse file');
    } finally {
      setParsing(false);
    }
  };

  const handleApprove = async () => {
    if (!importId) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/price-imports/${importId}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to approve'); return; }
      toast.success(`Applied ${data.applied} lines to the draft.`);
      setOpen(false);
      reset();
      onApproved();
    } catch {
      toast.error('Failed to approve import');
    } finally {
      setApproving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <Button size="sm" onClick={() => setOpen(true)}><Upload className="w-4 h-4 mr-2" />Import</Button>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Price List</DialogTitle>
          <DialogDescription>
            Upload an .xlsx or .csv rate sheet for “{priceBook.name}” v{priceBook.version}. Nothing becomes active until you click Approve Import.
          </DialogDescription>
        </DialogHeader>

        {!summary && (
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <input id="pl-file" type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <label htmlFor="pl-file" className="cursor-pointer">
                <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm">{file ? file.name : 'Click to choose a price list file'}</p>
                <p className="text-xs text-muted-foreground mt-1">Accepts .xlsx, .xls, .csv</p>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => handleUpload(false)} disabled={!file || parsing} className="flex-1">
                {parsing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}Upload &amp; Preview
              </Button>
              <Button variant="outline" onClick={() => handleUpload(true)} disabled={!file || parsing}>
                Use AI Column Mapping
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Tip: download the template from the Price Books page for the exact column format.</p>
          </div>
        )}

        {summary && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              <Stat label="Total Rows" value={summary.totalRows} />
              <Stat label="Valid" value={summary.validRows} />
              <Stat label="New" value={summary.newItems} className="text-blue-600" />
              <Stat label="Unchanged" value={summary.unchanged} />
              <Stat label="Increases" value={summary.rateIncreases} className="text-red-600" />
              <Stat label="Decreases" value={summary.rateDecreases} className="text-green-600" />
              <Stat label="Duplicates" value={summary.duplicateJobCodes} className="text-amber-600" />
              <Stat label="Need Fix" value={summary.rowsRequiringCorrection} className="text-red-600" />
            </div>

            {errorCount > 0 && importId && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4" />{errorCount} row(s) require correction and will be skipped.
                </div>
                <a href={`/api/price-imports/${importId}/errors`}><Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" />Download Errors</Button></a>
              </div>
            )}

            <div className="max-h-64 overflow-y-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-2 px-3">Job Code</th><th className="py-2 px-3">Description</th>
                    <th className="py-2 px-3 text-right">Current</th><th className="py-2 px-3 text-right">Uploaded</th>
                    <th className="py-2 px-3 text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.changes.map((c, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1.5 px-3 font-mono font-medium">{c.jobCode}</td>
                      <td className="py-1.5 px-3 truncate max-w-[240px]">{c.description}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{c.currentRate == null ? '—' : formatCents(c.currentRate)}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{formatCents(c.uploadedRate)}</td>
                      <td className={`py-1.5 px-3 text-right font-mono ${KIND_STYLE[c.kind] ?? ''}`}>
                        {c.kind === 'new' ? 'NEW' : c.diff == null || c.diff === 0 ? '—' : (c.diff > 0 ? '+' : '') + formatCents(c.diff)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={reset}><XCircle className="w-4 h-4 mr-2" />Cancel</Button>
              <Button onClick={handleApprove} disabled={approving || summary.validRows === 0}>
                {approving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}Approve Import
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="p-2 rounded-lg bg-muted/50 text-center">
      <div className={`text-lg font-semibold font-mono ${className ?? ''}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
