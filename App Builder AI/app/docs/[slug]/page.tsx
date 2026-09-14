import { notFound } from 'next/navigation';
import Link from 'next/link';
import { DocsShell } from '@/components/docs/docs-shell';
import { docsArticles, docsCategories, getDocsArticle } from '@/lib/docs-data';

export function generateStaticParams() {
  return docsArticles.map((article) => ({ slug: article.slug }));
}

export default async function DocsArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getDocsArticle(slug);
  if (!article) {
    notFound();
  }

  const category = docsCategories.find((c) => c.id === article.category);
  const index = docsArticles.findIndex((a) => a.slug === article.slug);
  const prev = index > 0 ? docsArticles[index - 1] : null;
  const next =
    index >= 0 && index < docsArticles.length - 1
      ? docsArticles[index + 1]
      : null;

  return (
    <DocsShell activeSlug={article.slug}>
      <article className="rounded-2xl border border-border-light bg-white p-8 tablet-up:p-12">
        {category && (
          <p className="font-display text-sm uppercase tracking-[0.2em] text-appweaver-orange">
            {category.title}
          </p>
        )}
        <h1 className="mt-3 font-display text-[32px] leading-none tracking-[-1.2px] text-text-agent-heading tablet-up:text-[40px]">
          {article.title}
        </h1>
        <p className="mt-3 font-display text-base text-text-dim">
          {article.summary}
        </p>

        <div className="mt-8 space-y-8">
          {article.sections.map((section) => (
            <div key={section.heading}>
              <h2 className="font-display text-xl tracking-[-0.02em] text-text-agent-heading">
                {section.heading}
              </h2>
              <div className="mt-2 space-y-3">
                {section.body.map((paragraph, i) => (
                  <p
                    key={i}
                    className="font-display text-base leading-relaxed text-text-dim">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-border-light pt-6 tablet-up:flex-row tablet-up:justify-between">
          {prev ? (
            <Link
              href={`/docs/${prev.slug}`}
              className="text-sm text-text-secondary hover:text-text-primary">
              ← {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={`/docs/${next.slug}`}
              className="text-sm text-text-secondary hover:text-text-primary">
              {next.title} →
            </Link>
          )}
        </div>
      </article>
    </DocsShell>
  );
}
