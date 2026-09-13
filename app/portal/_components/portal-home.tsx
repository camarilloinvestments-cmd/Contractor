'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { MapPin, ChevronRight, Briefcase, CheckCircle2, Clock } from 'lucide-react';
import Link from 'next/link';
import { FadeIn, Stagger, StaggerItem } from '@/components/ui/animate';

export function PortalHome() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/portal/jobs').then(r => r.json()).then(setJobs).catch(console.error).finally(() => setLoading(false));
  }, []);

  const activeTasks = (jobs ?? []).reduce((sum: number, j: any) => sum + ((j?.tasks ?? []).filter((t: any) => t?.status === 'IN_PROGRESS' || t?.status === 'PENDING')?.length ?? 0), 0);
  const completedThisWeek = (jobs ?? []).reduce((sum: number, j: any) => sum + ((j?.tasks ?? []).filter((t: any) => t?.status === 'APPROVED' || t?.status === 'SUBMITTED')?.length ?? 0), 0);

  if (loading) {
    return <div className="max-w-lg mx-auto p-4 space-y-4">{[1,2,3].map(i => <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />)}</div>;
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <FadeIn>
        <div>
          <h1 className="text-xl font-display font-bold tracking-tight">My Jobs</h1>
          <p className="text-sm text-muted-foreground">Your assigned work orders</p>
        </div>
      </FadeIn>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <Clock className="w-6 h-6 text-amber-500 mx-auto mb-1" />
            <p className="text-2xl font-bold font-mono">{activeTasks}</p>
            <p className="text-xs text-muted-foreground">Active Tasks</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <CheckCircle2 className="w-6 h-6 text-green-500 mx-auto mb-1" />
            <p className="text-2xl font-bold font-mono">{completedThisWeek}</p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </CardContent>
        </Card>
      </div>

      <Stagger staggerDelay={0.05}>
        <div className="space-y-3">
          {(jobs ?? []).map((job: any) => (
            <StaggerItem key={job?.id}>
              <Link href={`/portal/job/${job?.id}`}>
                <Card className="hover:shadow-md transition-shadow active:scale-[0.98]">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Briefcase className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-sm">{job?.jobName ?? ''}</h3>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="w-3 h-3" />
                            <span className="truncate max-w-[180px]">{[job?.address, job?.city].filter(Boolean).join(', ') || 'No address'}</span>
                          </div>
                          <div className="flex gap-2 mt-1">
                            <StatusBadge status={job?.status} />
                            <span className="text-xs text-muted-foreground">{job?.tasks?.length ?? 0} tasks</span>
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </StaggerItem>
          ))}
          {(jobs?.length ?? 0) === 0 && (
            <div className="text-center py-12">
              <Briefcase className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No jobs assigned yet</p>
            </div>
          )}
        </div>
      </Stagger>
    </div>
  );
}
