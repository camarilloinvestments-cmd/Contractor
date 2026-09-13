'use client';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const statusStyles: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  ACTIVE: 'bg-blue-100 text-blue-700 border-blue-200',
  IN_PROGRESS: 'bg-amber-100 text-amber-700 border-amber-200',
  UNDER_REVIEW: 'bg-purple-100 text-purple-700 border-purple-200',
  APPROVED: 'bg-green-100 text-green-700 border-green-200',
  INVOICED: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  CLOSED: 'bg-gray-100 text-gray-600 border-gray-200',
  PENDING: 'bg-amber-100 text-amber-700 border-amber-200',
  SUBMITTED: 'bg-purple-100 text-purple-700 border-purple-200',
  REJECTED: 'bg-red-100 text-red-700 border-red-200',
  SENT: 'bg-blue-100 text-blue-700 border-blue-200',
  PAID: 'bg-green-100 text-green-700 border-green-200',
  PROCESSING: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  SUBCONTRACTOR: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  IN_HOUSE: 'bg-teal-100 text-teal-700 border-teal-200',
};

const statusLabels: Record<string, string> = {
  IN_PROGRESS: 'In Progress',
  UNDER_REVIEW: 'Under Review',
  IN_HOUSE: 'In-House',
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const s = status ?? 'DRAFT';
  const style = statusStyles[s] ?? 'bg-gray-100 text-gray-700 border-gray-200';
  const label = statusLabels[s] ?? s?.replace(/_/g, ' ') ?? '';
  return (
    <Badge variant="outline" className={cn('text-xs font-medium border', style, className)}>
      {label?.charAt(0)?.toUpperCase()}{label?.slice(1)?.toLowerCase()}
    </Badge>
  );
}
