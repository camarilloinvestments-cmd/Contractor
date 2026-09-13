'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const COLORS = ['#60B5FF', '#FF9149', '#80D8C3', '#FF9898', '#A19AD3', '#72BF78', '#FF90BB', '#FF6363'];

export function ReportCharts({ data, type }: { data: any[]; type: string }) {
  if ((data?.length ?? 0) === 0) return null;

  const chartData = (data ?? []).slice(0, 10).map((d: any) => ({
    name: type === 'job' ? (d?.jobNumber ?? '') : (d?.companyName ?? ''),
    profit: (d?.profit ?? 0) / 100,
    margin: d?.margin ?? 0,
  }));

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Profit by {type === 'job' ? 'Job' : 'Contractor'}</CardTitle></CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ bottom: 40, left: 20 }}>
              <XAxis dataKey="name" tickLine={false} tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} interval="preserveStartEnd" />
              <YAxis tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
              <Tooltip formatter={(value: number) => [`$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 'Profit']} />
              <Bar dataKey="profit" radius={[6, 6, 0, 0]}>
                {chartData.map((_: any, idx: number) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
