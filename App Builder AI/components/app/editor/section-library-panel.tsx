'use client';

import { trackSave } from '@/lib/save-tracker';

import { useEffect, useState, useTransition } from 'react';

import {
  insertSectionIntoProjectAction,
  listTemplateFavoritesAction,
  toggleTemplateFavoriteAction,
} from '@/lib/actions/templates';
import { useToast } from '@/components/ui/toast';
import { TemplatePreviewDialog } from '@/components/app/templates/template-preview-dialog';
import type { WebsiteTemplateSummary } from '@/lib/queries/templates';

type SectionLibraryPanelProps = {
  projectId: string;
  activeArtifactId: string | null;
  sections: WebsiteTemplateSummary[];
  onInserted: () => void;
};

/**
 * Browsable library of ready-made sections (Flow 3 / Flow 5 in the product
 * concept) that can be dropped into the currently active artifact's
 * index.html without leaving the editor.
 */
export function SectionLibraryPanel({
  projectId,
  activeArtifactId,
  sections,
  onInserted,
}: SectionLibraryPanelProps) {
  const { error: toastError, success: toastSuccess } = useToast();
  const [isPending, startTransition] = useTransition();
  const [insertingSlug, setInsertingSlug] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [previewSection, setPreviewSection] =
    useState<WebsiteTemplateSummary | null>(null);

  const [favoritesOnly, setFavoritesOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listTemplateFavoritesAction().then(({ slugs }) => {
      if (!cancelled) setFavorites(new Set(slugs));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (sections.length === 0) return null;

  const orderedSections = [...sections]
    .filter((section) => !favoritesOnly || favorites.has(section.slug))
    .sort(
      (a, b) => Number(favorites.has(b.slug)) - Number(favorites.has(a.slug)),
    );

  function handleToggleFavorite(slug: string) {
    const next = !favorites.has(slug);
    setFavorites((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(slug);
      else copy.delete(slug);
      return copy;
    });
    const rollback = () =>
      setFavorites((prev) => {
        const copy = new Set(prev);
        if (next) copy.delete(slug);
        else copy.add(slug);
        return copy;
      });
    toggleTemplateFavoriteAction(slug, next)
      .then((result) => {
        if (result?.error) {
          toastError(result.error);
          rollback();
        }
      })
      .catch(() => {
        toastError('Could not update favorites.');
        rollback();
      });
  }

  function handleInsert(section: WebsiteTemplateSummary) {
    if (!activeArtifactId) {
      toastError('Select an artifact first.');
      return;
    }

    setInsertingSlug(section.slug);
    startTransition(async () => {
      const result = await trackSave(
        insertSectionIntoProjectAction({
          projectId,
          artifactId: activeArtifactId,
          templateSlug: section.slug,
        }),
      );

      setInsertingSlug(null);

      if (result?.error) {
        toastError(result.error);
        return;
      }

      toastSuccess(`Added "${section.name}" to your page.`);
      onInserted();
    });
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
          Sections
        </h3>
        <button
          type="button"
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((value) => !value)}
          className={
            favoritesOnly
              ? 'text-xs text-appweaver-orange'
              : 'text-xs text-app-text-muted hover:text-appweaver-orange'
          }>
          ★ Favorites
        </button>
      </div>
      <ul className="space-y-1.5">
        {orderedSections.map((section) => (
          <li key={section.id} className="flex items-stretch gap-1">
            <button
              type="button"
              disabled={isPending || !activeArtifactId}
              onClick={() => handleInsert(section)}
              className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg border border-app-border-subtle px-2.5 py-2 text-left transition-colors hover:bg-app-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
              <span className="truncate text-sm text-app-text">
                {section.name}
              </span>
              <span className="truncate text-xs text-app-text-muted">
                {insertingSlug === section.slug
                  ? 'Adding…'
                  : (section.description ?? 'Insert into current page')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPreviewSection(section)}
              className="px-1.5 text-xs text-app-text-muted hover:text-appweaver-orange">
              Preview
            </button>
            <button
              type="button"
              aria-label={
                favorites.has(section.slug)
                  ? 'Remove from favorites'
                  : 'Add to favorites'
              }
              onClick={() => handleToggleFavorite(section.slug)}
              className={
                favorites.has(section.slug)
                  ? 'px-1.5 text-appweaver-orange'
                  : 'px-1.5 text-app-text-muted hover:text-appweaver-orange'
              }>
              {favorites.has(section.slug) ? '★' : '☆'}
            </button>
          </li>
        ))}
      </ul>
      <TemplatePreviewDialog
        slug={previewSection?.slug ?? null}
        name={previewSection?.name ?? ''}
        actionLabel="Add to my page"
        actionPending={isPending}
        onAction={() => {
          if (!previewSection) return;
          handleInsert(previewSection);
          setPreviewSection(null);
        }}
        onClose={() => setPreviewSection(null)}
      />
    </section>
  );
}
