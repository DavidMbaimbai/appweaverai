'use client';

import { trackSave } from '@/lib/save-tracker';

import { useEffect, useState, useTransition } from 'react';

import { useToast } from '@/components/ui/toast';
import {
  addSavedPageToProjectAction,
  listSavedPagesAction,
  savePageAsTemplateAction,
} from '@/lib/actions/saved-pages';
import {
  deleteSavedSectionAction,
  getSavedSectionPreviewAction,
  insertSavedSectionAction,
  listPageSectionsAction,
  listSavedSectionsAction,
  saveSectionAsTemplateAction,
} from '@/lib/actions/saved-sections';
import { TemplatePreviewDialog } from '@/components/app/templates/template-preview-dialog';
import { SAVED_SECTIONS_CHANGED_EVENT } from '@/lib/saved-sections-events';
import type { PageSection } from '@/lib/saved-sections';

type SavedSection = { id: string; name: string };

type MySectionsPanelProps = {
  projectId: string;
  activeArtifactId: string | null;
  onInserted: () => void;
};

/** Personal section library: save a section of the current page and reuse it anywhere (Flow 5). */
export function MySectionsPanel({
  projectId,
  activeArtifactId,
  onInserted,
}: MySectionsPanelProps) {
  const { error: toastError, success: toastSuccess } = useToast();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState<SavedSection[]>([]);
  const [savedPages, setSavedPages] = useState<SavedSection[]>([]);
  const [pageSections, setPageSections] = useState<PageSection[]>([]);
  const [saving, setSaving] = useState(false);
  const [sectionIndex, setSectionIndex] = useState('');
  const [name, setName] = useState('');
  const [previewing, setPreviewing] = useState<SavedSection | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      listSavedPagesAction().then(({ pages }) => {
        if (!cancelled) setSavedPages(pages);
      });
      listSavedSectionsAction().then((result) => {
        if (!cancelled && 'sections' in result && result.sections) {
          setSaved(result.sections);
        }
      });
    }
    load();
    window.addEventListener(SAVED_SECTIONS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SAVED_SECTIONS_CHANGED_EVENT, load);
    };
  }, []);

  function openSaveForm() {
    if (!activeArtifactId) {
      toastError('Select an artifact first.');
      return;
    }
    startTransition(async () => {
      const result = await listPageSectionsAction(projectId, activeArtifactId);
      if ('error' in result) {
        toastError(result.error ?? 'Could not read the page.');
        return;
      }
      if (result.sections.length === 0) {
        toastError('This page has no sections to save yet.');
        return;
      }
      setPageSections(result.sections);
      setSectionIndex(String(result.sections[0].index));
      setName('');
      setSaving(true);
    });
  }

  function handleSave() {
    if (!activeArtifactId) return;
    startTransition(async () => {
      const result = await saveSectionAsTemplateAction({
        projectId,
        artifactId: activeArtifactId,
        sectionIndex: Number(sectionIndex),
        name,
      });
      if (result.error || !result.section) {
        toastError(result.error ?? 'Could not save the section.');
        return;
      }
      setSaved((prev) => [result.section, ...prev]);
      setSaving(false);
      toastSuccess(`Saved "${result.section.name}" to your library.`);
    });
  }

  function handleInsert(section: SavedSection) {
    if (!activeArtifactId) {
      toastError('Select an artifact first.');
      return;
    }
    startTransition(async () => {
      const result = await trackSave(
        insertSavedSectionAction({
          projectId,
          artifactId: activeArtifactId,
          savedSectionId: section.id,
        }),
      );
      if (result.error) {
        toastError(result.error);
        return;
      }
      toastSuccess(`Added "${section.name}" to your page.`);
      onInserted();
    });
  }

  function handleDelete(section: SavedSection) {
    startTransition(async () => {
      const result = await deleteSavedSectionAction(section.id);
      if (result.error) {
        toastError(result.error);
        return;
      }
      setSaved((prev) => prev.filter((s) => s.id !== section.id));
    });
  }

  function handleSavePage() {
    if (!activeArtifactId) {
      toastError('Select an artifact first.');
      return;
    }
    const pageName = window.prompt('Name this page template');
    if (!pageName?.trim()) return;

    startTransition(async () => {
      const result = await savePageAsTemplateAction({
        projectId,
        artifactId: activeArtifactId,
        name: pageName,
      });
      if (result.error) {
        toastError(result.error);
        return;
      }
      toastSuccess('Page saved. Find it under Templates › My saved pages.');
      listSavedPagesAction().then(({ pages }) => setSavedPages(pages));
    });
  }

  function handleAddPage(page: SavedSection) {
    if (!activeArtifactId) {
      toastError('Select an artifact first.');
      return;
    }
    startTransition(async () => {
      const result = await trackSave(
        addSavedPageToProjectAction({
          projectId,
          artifactId: activeArtifactId,
          savedPageId: page.id,
        }),
      );
      if (result.error) {
        toastError(result.error);
        return;
      }
      toastSuccess(`Added "${page.name}" as ${result.path}.`);
      onInserted();
    });
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
          My sections
        </h3>
        <button
          type="button"
          disabled={isPending || !activeArtifactId}
          onClick={openSaveForm}
          className="text-xs text-appweaver-orange disabled:opacity-50">
          Save as template
        </button>
      </div>
      <button
        type="button"
        disabled={isPending || !activeArtifactId}
        onClick={handleSavePage}
        className="mb-2 text-xs text-appweaver-orange disabled:opacity-50">
        Save full page as template
      </button>

      {savedPages.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {savedPages.map((page) => (
            <li
              key={page.id}
              className="flex items-center gap-1 rounded-lg border border-app-border-subtle px-2.5 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate text-app-text">
                {page.name}
              </span>
              <button
                type="button"
                disabled={isPending || !activeArtifactId}
                onClick={() => handleAddPage(page)}
                className="text-appweaver-orange disabled:opacity-50">
                Add as page
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {saving ? (
        <div className="mb-2 space-y-1.5 rounded-lg border border-app-border-subtle p-2">
          <select
            value={sectionIndex}
            onChange={(e) => setSectionIndex(e.target.value)}
            className="w-full rounded-md border border-app-border-subtle bg-transparent px-2 py-1 text-xs text-app-text">
            {pageSections.map((s) => (
              <option key={s.index} value={s.index}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Section name"
            className="w-full rounded-md border border-app-border-subtle bg-transparent px-2 py-1 text-xs text-app-text"
          />
          <div className="flex justify-end gap-2 text-xs">
            <button type="button" onClick={() => setSaving(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending || !name.trim()}
              onClick={handleSave}
              className="text-appweaver-orange disabled:opacity-50">
              Save
            </button>
          </div>
        </div>
      ) : null}

      {saved.length === 0 ? (
        <p className="text-xs text-app-text-muted">
          Sections you save appear here and can be reused in any website.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {saved.map((section) => (
            <li
              key={section.id}
              className="flex items-center gap-1 rounded-lg border border-app-border-subtle">
              <button
                type="button"
                disabled={isPending || !activeArtifactId}
                onClick={() => handleInsert(section)}
                className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm text-app-text hover:bg-app-surface-hover disabled:opacity-50">
                {section.name}
              </button>
              <button
                type="button"
                onClick={() => setPreviewing(section)}
                className="px-1.5 text-xs text-app-text-muted hover:text-appweaver-orange">
                Preview
              </button>
              <button
                type="button"
                aria-label={`Delete ${section.name}`}
                disabled={isPending}
                onClick={() => handleDelete(section)}
                className="px-2 text-xs text-app-text-muted hover:text-appweaver-orange">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <TemplatePreviewDialog
        slug={previewing?.id ?? null}
        name={previewing?.name ?? ''}
        loadPreview={getSavedSectionPreviewAction}
        actionLabel="Add to my page"
        actionPending={isPending}
        onAction={() => {
          if (!previewing) return;
          handleInsert(previewing);
          setPreviewing(null);
        }}
        onClose={() => setPreviewing(null)}
      />
    </section>
  );
}
