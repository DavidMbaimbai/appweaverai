'use client';

import { Select } from '@/components/ui/select';
import { buildFilterOptions, sortOptions } from '@/lib/app-types';
import type { ProjectBuildFilter, ProjectSort } from '@/lib/app-types';

type ProjectFilterProps = {
  buildFilter: ProjectBuildFilter;
  sort: ProjectSort;
  onBuildFilterChange: (value: ProjectBuildFilter) => void;
  onSortChange: (value: ProjectSort) => void;
  projectCount: number;
};

export function ProjectFilters({
  buildFilter,
  sort,
  onBuildFilterChange,
  onSortChange,
  projectCount,
}: ProjectFilterProps) {
  return (
    <div className="flex flex-col gap-3 tablet-up:flex-row tablet-up:items-center tablet-up:justify-between">
      <p className="text-sm text-app-text-muted">
        {projectCount} project{projectCount === 1 ? '' : 's'}
      </p>
      <div className="flex flex-col gap-2 mobile:grid mobile:grid-cols-1 tablet-up:flex-row tablet-up:items-center tablet-up:gap-2">
        <Select
          value={buildFilter}
          onChange={(event) =>
            onBuildFilterChange(event.target.value as ProjectBuildFilter)
          }
          aria-label="Filter by build type"
          className="tablet-up:w-52"
          theme="app">
          {buildFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as ProjectSort)}
          aria-label="Sort projects"
          className="tablet-up:w-56"
          theme="app">
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
