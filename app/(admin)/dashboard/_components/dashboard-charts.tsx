'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { formatCents } from '@/lib/utils/format';
import { FadeIn } from '@/components/ui/animate';

const COLORS = ['#60B5FF', '#FF9149', '#80D8C3', '#FF9898', '#A19AD3'];

export function DashboardCharts({ data }: { data: any }) {
  const financialData = [
    { name: 'Revenue', value: (data?.totalRevenue ?? 0) / 100 },
    { name: 'Cost', value: (data?.totalCost ?? 0) / 100 },
    { name: 'Profit', value: (data?.totalProfit ?? 0) / 100 },
  ];

  const jobStatusData = [
    { name: 'Active', value: data?.activeJobs ?? 0 },
    { name: 'Review', value: data?.pendingReviews ?? 0 },
    { name: 'Total', value: data?.totalJobs ?? 0 },
  ];

  return (
    <FadeIn delay={0.1}>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Financial Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={financialData}>
                <XAxis dataKey="name" tickLine={false} tick={{ fontSize: 11 }} />
                <YAxis tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value: number) => [`$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, '']} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {financialData.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </FadeIn>
  );
}
