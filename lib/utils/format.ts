export function formatCents(cents: number | null | undefined): string {
  const val = (cents ?? 0) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(val);
}

export function formatCentsToNumber(cents: number | null | undefined): number {
  return (cents ?? 0) / 100;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function formatPercent(value: number | null | undefined): string {
  return `${(value ?? 0).toFixed(1)}%`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateShort(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
