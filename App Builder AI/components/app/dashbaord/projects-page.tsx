'use client';

import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/app/shell/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import type {
  AppProject,
  ProjectBuildFilter,
  ProjectSort,
} from '@/lib/app-types';
import { cn } from '@/lib/utils';

import { ProjectFilters } from './project-filters';
import { PROJECT_LIST_GRID } from './project-list-layout';
import { ProjectListItem } from './project-list-item';

type ProjectsPageProps = {
  projects: AppProject[];
};

export function ProjectsPage({ projects }: ProjectsPageProps) {
  const [search, setSearch] = useState('');
  const [buildFilter, setBuildFilter] = useState<ProjectBuildFilter>('all');
  const [sort, setSort] = useState<ProjectSort>('last_opened');

  const sortedProjects = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = projects.filter((project) => {
      const matchesSearch =
        !query ||
        project.name.toLowerCase().includes(query) ||
        (project.description?.toLowerCase().includes(query) ?? false);

      const matchesBuild =
        buildFilter === 'all' ||
        project.artifacts.some((artifact) => artifact.type === buildFilter);

      return matchesSearch && matchesBuild;
    });

    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'last_updated') {
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      }

      const aOpened = a.lastOpenedAt
        ? new Date(a.lastOpenedAt).getTime()
        : new Date(a.updatedAt).getTime();
      const bOpened = b.lastOpenedAt
        ? new Date(b.lastOpenedAt).getTime()
        : new Date(b.updatedAt).getTime();
      return bOpened - aOpened;
    });
  }, [projects, search, buildFilter, sort]);

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Projects">
        <div className="w-full max-w-sm">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search projects..."
            theme="app"
          />
        </div>
      </PageHeader>

      <div className="mx-auto w-full max-w-app-content flex-1 px-4 py-6 tablet-up:px-8">
        <ProjectFilters
          buildFilter={buildFilter}
          sort={sort}
          onBuildFilterChange={setBuildFilter}
          onSortChange={setSort}
          projectCount={sortedProjects.length}
        />

        {sortedProjects.length > 0 ? (
          <div className="mt-6 overflow-hidden rounded-xl border border-app-border bg-app-surface">
            <div
              className={cn(
                'hidden border-b border-app-border-subtle bg-app-surface-active/50 px-5 py-3',
                PROJECT_LIST_GRID,
              )}>
              <span className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
                Project
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
                Artifacts
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
                Status
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
                Last opened
              </span>
              <span className="text-right text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
                Actions
              </span>
            </div>

            <ul className="divide-y divide-app-border-subtle">
              {sortedProjects.map((project) => (
                <ProjectListItem key={project.id} project={project} />
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            className="mt-6"
            theme="app"
            title="No projects yet"
            description="Go to Home and describe what you want to build. Your projects will appear here."
            action={
              <Button href="/app" variant="secondary" size="sm" theme="app">
                Go to Home
              </Button>
            }
          />
        )}
      </div>
    </main>
  );
}
