// Shared money math for commercial documents. All monetary values are integer
// cents. Line amount = round(quantity * unitPrice). Totals are derived from the
// lines and an optional tax rate (percent).

export type LineInput = {
  description?: string;
  quantity?: number;
  unit?: string | null;
  unitPrice?: number; // cents
  jobCode?: string | null;
  priceBookId?: string | null;
  priceBookVersionId?: string | null;
  sortOrder?: number;
};

export type NormalizedLine = {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  amount: number;
  jobCode: string | null;
  priceBookId: string | null;
  priceBookVersionId: string | null;
  sortOrder: number;
};

export function lineAmount(quantity: number, unitPrice: number): number {
  return Math.round((quantity || 0) * (unitPrice || 0));
}

export function normalizeLines(items: LineInput[] | undefined): NormalizedLine[] {
  return (items ?? [])
    .filter((it) => (it?.description ?? '').trim().length > 0)
    .map((it, idx) => {
      const quantity = Number(it.quantity ?? 1) || 0;
      const unitPrice = Math.round(Number(it.unitPrice ?? 0)) || 0;
      return {
        description: String(it.description ?? '').trim(),
        quantity,
        unit: it.unit ?? null,
        unitPrice,
        amount: lineAmount(quantity, unitPrice),
        jobCode: it.jobCode ?? null,
        priceBookId: it.priceBookId ?? null,
        priceBookVersionId: it.priceBookVersionId ?? null,
        sortOrder: it.sortOrder ?? idx,
      };
    });
}

export function computeTotals(
  lines: { amount: number }[],
  taxRate: number
): { subtotal: number; taxRate: number; taxAmount: number; total: number } {
  const subtotal = lines.reduce((sum, l) => sum + (l.amount || 0), 0);
  const rate = Number(taxRate) || 0;
  const taxAmount = Math.round((subtotal * rate) / 100);
  return { subtotal, taxRate: rate, taxAmount, total: subtotal + taxAmount };
}
