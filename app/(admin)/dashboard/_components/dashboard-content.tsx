'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { formatCents } from '@/lib/utils/format';
import { Briefcase, AlertCircle, DollarSign, TrendingUp, Activity } from 'lucide-react';
import Link from 'next/link';
import { FadeIn, SlideIn } from '@/components/ui/animate';
import dynamic from 'next/dynamic';

const DashboardCharts = dynamic(() => import('./dashboard-charts').then(m => m.DashboardCharts), { ssr: false });

export function DashboardContent() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />)}
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'Active Jobs', value: data?.activeJobs ?? 0, icon: Briefcase, color: 'text-blue-600 bg-blue-50' },
    { label: 'Pending Reviews', value: data?.pendingReviews ?? 0, icon: AlertCircle, color: 'text-amber-600 bg-amber-50' },
    { label: 'Total Revenue', value: formatCents(data?.totalRevenue ?? 0), icon: DollarSign, color: 'text-green-600 bg-green-50' },
    { label: 'Profit Margin', value: `${(data?.margin ?? 0).toFixed(1)}%`, icon: TrendingUp, color: 'text-indigo-600 bg-indigo-50' },
  ];

  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your fiber construction operations</p>
        </div>
      </FadeIn>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <SlideIn key={idx} from="bottom" delay={idx * 0.1}>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${stat.color}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{stat.label}</p>
                      <p className="text-2xl font-bold font-mono">{stat.value}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </SlideIn>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DashboardCharts data={data} />

        <FadeIn delay={0.2}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Recent Jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(data?.recentJobs ?? []).map((job: any) => (
                  <Link key={job?.id} href={`/jobs/${job?.id}`} className="block">
                    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
                      <div>
                        <p className="font-medium text-sm">{job?.jobName ?? ''}</p>
                        <p className="text-xs text-muted-foreground">{job?.primeContractor ?? ''} · {job?.taskCount ?? 0} tasks</p>
                      </div>
                      <StatusBadge status={job?.status} />
                    </div>
                  </Link>
                ))}
                {(data?.recentJobs?.length ?? 0) === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No jobs yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
