import { ProjectsManager } from './_components/projects-manager';

export default async function ProjectsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectsManager primeId={id} />;
}
