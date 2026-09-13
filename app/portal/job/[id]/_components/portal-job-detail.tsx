'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { ArrowLeft, MapPin, Navigation, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { FadeIn, Stagger, StaggerItem } from '@/components/ui/animate';
import dynamic from 'next/dynamic';

const MapViewer = dynamic(() => import('@/components/maps/map-viewer').then(m => m.MapViewer), {
  ssr: false, loading: () => <div className="h-48 bg-muted animate-pulse rounded-lg" />
});

export function PortalJobDetail({ id }: { id: string }) {
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/jobs/${id}`).then(r => r.json()).then(setJob).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="max-w-lg mx-auto p-4"><div className="h-96 bg-muted animate-pulse rounded-lg" /></div>;

  const address = [job?.address, job?.city, job?.state, job?.zip].filter(Boolean).join(', ');
  const directionsUrl = job?.latitude && job?.longitude
    ? `https://www.google.com/maps/dir/?api=1&destination=${job.latitude},${job.longitude}`
    : address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : null;

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <FadeIn>
        <div className="flex items-center gap-3">
          <Link href="/portal"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div>
            <h1 className="text-lg font-display font-bold tracking-tight">{job?.jobName ?? ''}</h1>
            <div className="flex items-center gap-2">
              <StatusBadge status={job?.status} />
              <span className="text-xs font-mono text-muted-foreground">{job?.jobNumber ?? ''}</span>
            </div>
          </div>
        </div>
      </FadeIn>

      {address && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary flex-shrink-0" />
              <p className="text-sm flex-1">{address}</p>
              {directionsUrl && (
                <a href={directionsUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="gap-1">
                    <Navigation className="w-3 h-3" />Directions
                  </Button>
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {job?.latitude && job?.longitude && (
        <MapViewer center={[job.latitude, job.longitude]} markers={[{ lat: job.latitude, lng: job.longitude, label: job?.jobName ?? '' }]} className="h-48" />
      )}

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">MY TASKS</h2>
        <Stagger staggerDelay={0.05}>
          <div className="space-y-2">
            {(job?.tasks ?? []).map((task: any) => (
              <StaggerItem key={task?.id}>
                <Link href={`/portal/task/${task?.id}`}>
                  <Card className="hover:shadow-md transition-shadow active:scale-[0.98]">
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{task?.taskType?.name ?? ''}</p>
                          <p className="text-xs text-muted-foreground">{task?.quantity ?? 0} {task?.taskType?.unitOfMeasure ?? ''}{task?.description ? ` · ${task.description}` : ''}</p>
                          <StatusBadge status={task?.status} className="mt-1" />
                        </div>
                        <ChevronRight className="w-5 h-5 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </StaggerItem>
            ))}
          </div>
        </Stagger>
      </div>
    </div>
  );
}
