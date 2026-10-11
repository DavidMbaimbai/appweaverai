'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';

import {
  createProjectFromSavedPageAction,
  createProjectFromTemplateAction,
  listTemplateFavoritesAction,
  toggleTemplateFavoriteAction,
} from '@/lib/actions/templates';
import {
  deleteSavedPageAction,
  listSavedPagesAction,
} from '@/lib/actions/saved-pages';
import { useToast } from '@/components/ui/toast';
import { TemplatePreviewDialog } from './template-preview-dialog';
import type { WebsiteTemplateSummary } from '@/lib/queries/templates';

const MARKET_LABELS: Record<string, string> = {
  FREELANCER: 'Personal branding',
  SMALL_BUSINESS: 'Small business',
  AGENCY: 'Agency',
  SAAS: 'SaaS',
  GENERAL: 'General',
};

const MARKET_FILTERS = [
  'ALL',
  'FREELANCER',
  'SMALL_BUSINESS',
  'AGENCY',
  'SAAS',
  'GENERAL',
] as const;

type TemplatesGalleryProps = {
  templates: WebsiteTemplateSummary[];
  sections: WebsiteTemplateSummary[];
};

export function TemplatesGallery({
  templates,
  sections,
}: TemplatesGalleryProps) {
  const { error: toastError } = useToast();
  const [market, setMarket] = useState<(typeof MARKET_FILTERS)[number]>('ALL');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [savedPages, setSavedPages] = useState<
    { id: string; name: string }[]
  >([]);
  const [isPending, startTransition] = useTransition();
  const [creatingSlug, setCreatingSlug] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{
    template: WebsiteTemplateSummary;
    isSection: boolean;
  } | null>(null);

  useEffect(() => {
    listTemplateFavoritesAction().then(({ slugs }) =>
      setFavorites(new Set(slugs)),
    );
    listSavedPagesAction().then(({ pages }) => setSavedPages(pages));
  }, []);

  const filteredTemplates = useMemo(
    () =>
      templates
        .filter((t) => market === 'ALL' || t.market === market)
        .filter((t) => !favoritesOnly || favorites.has(t.slug)),
    [templates, market, favoritesOnly, favorites],
  );

  const filteredSections = useMemo(
    () =>
      sections.filter((s) => market === 'ALL' || s.market === market),
    [sections, market],
  );

  function handleToggleFavorite(slug: string) {
    const next = !favorites.has(slug);
    setFavorites((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(slug);
      else copy.delete(slug);
      return copy;
    });
    toggleTemplateFavoriteAction(slug, next).then((result) => {
      if (result?.error) toastError(result.error);
    });
  }

  function handleUseSavedPage(id: string) {
    setCreatingSlug(id);
    startTransition(async () => {
      const result = await createProjectFromSavedPageAction(id);
      if (result?.error) {
        setCreatingSlug(null);
        toastError(result.error);
      }
    });
  }

  function handleDeleteSavedPage(id: string) {
    setSavedPages((prev) => prev.filter((p) => p.id !== id));
    deleteSavedPageAction(id);
  }

  function handleUseTemplate(template: WebsiteTemplateSummary) {
    setCreatingSlug(template.slug);
    startTransition(async () => {
      const result = await createProjectFromTemplateAction(template.slug);
      // A successful run redirects server-side and never returns here.
      if (result?.error) {
        setCreatingSlug(null);
        toastError(result.error);
      }
    });
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2">
        {MARKET_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMarket(option)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              market === option
                ? 'border-app-accent-blue bg-app-accent-blue/10 text-app-accent-blue'
                : 'border-app-border text-app-text-muted hover:text-app-text'
            }`}>
            {option === 'ALL' ? 'All' : MARKET_LABELS[option]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setFavoritesOnly((v) => !v)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            favoritesOnly
              ? 'border-appweaver-orange bg-appweaver-orange/10 text-appweaver-orange'
              : 'border-app-border text-app-text-muted hover:text-app-text'
          }`}>
          ★ Favorites
        </button>
      </div>

      {savedPages.length > 0 ? (
        <div className="mb-8">
          <h2 className="mb-3 font-display text-lg text-app-text">
            My saved pages
          </h2>
          <div className="grid grid-cols-1 gap-3 tablet-up:grid-cols-2 desktop-up:grid-cols-3">
            {savedPages.map((page) => (
              <div
                key={page.id}
                className="flex items-center gap-2 rounded-xl border border-app-border-subtle px-4 py-3">
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-app-text">
                  {page.name}
                </p>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleUseSavedPage(page.id)}
                  className="text-xs text-appweaver-orange disabled:opacity-60">
                  {creatingSlug === page.id ? 'Creating…' : 'Use'}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${page.name}`}
                  onClick={() => handleDeleteSavedPage(page.id)}
                  className="text-xs text-app-text-muted hover:text-appweaver-orange">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {filteredTemplates.length === 0 ? (
        <p className="text-sm text-app-text-muted">
          No templates in this category yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 tablet-up:grid-cols-2 desktop-up:grid-cols-3">
          {filteredTemplates.map((template) => (
            <div
              key={template.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface">
              <div className="relative flex aspect-video items-center justify-center bg-app-surface-active text-xs text-app-text-muted">
                {MARKET_LABELS[template.market]}
                <button
                  type="button"
                  aria-label={
                    favorites.has(template.slug)
                      ? 'Remove from favorites'
                      : 'Add to favorites'
                  }
                  onClick={() => handleToggleFavorite(template.slug)}
                  className={`absolute right-2 top-2 text-lg ${
                    favorites.has(template.slug)
                      ? 'text-appweaver-orange'
                      : 'text-app-text-muted hover:text-appweaver-orange'
                  }`}>
                  {favorites.has(template.slug) ? '★' : '☆'}
                </button>
              </div>
              <div className="flex flex-1 flex-col gap-2 px-4 py-3">
                <p className="text-sm font-medium text-app-text">
                  {template.name}
                </p>
                <p className="flex-1 text-xs text-app-text-muted">
                  {template.description}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewTarget({ template, isSection: false })
                    }
                    className="rounded-lg border border-app-border px-3 py-2 text-sm font-medium text-app-text-secondary transition-colors hover:bg-app-surface-hover">
                    Preview
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleUseTemplate(template)}
                    className="flex-1 rounded-lg bg-appweaver-orange px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-appweaver-orange-mid disabled:cursor-not-allowed disabled:opacity-60">
                    {creatingSlug === template.slug
                      ? 'Creating…'
                      : 'Use this template'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {filteredSections.length > 0 ? (
        <div className="mt-10">
          <h2 className="mb-3 font-display text-lg text-app-text">
            Ready-made sections
          </h2>
          <p className="mb-4 text-sm text-app-text-muted">
            Preview a section here, then open any project, expand the Library
            panel on the left, and insert it directly into your page.
          </p>
          <div className="grid grid-cols-1 gap-3 tablet-up:grid-cols-2 desktop-up:grid-cols-3">
            {filteredSections.map((section) => (
              <div
                key={section.id}
                className="flex items-start gap-2 rounded-xl border border-app-border-subtle px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-app-text">
                    {section.name}
                  </p>
                  <p className="mt-1 text-xs text-app-text-muted">
                    {section.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setPreviewTarget({ template: section, isSection: true })
                  }
                  className="text-xs text-appweaver-orange">
                  Preview
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <TemplatePreviewDialog
        slug={previewTarget?.template.slug ?? null}
        name={previewTarget?.template.name ?? ''}
        actionLabel="Use this template"
        actionPending={
          isPending && creatingSlug === previewTarget?.template.slug
        }
        onAction={
          previewTarget && !previewTarget.isSection
            ? () => handleUseTemplate(previewTarget.template)
            : undefined
        }
        onClose={() => setPreviewTarget(null)}
      />
    </div>
  );
}
