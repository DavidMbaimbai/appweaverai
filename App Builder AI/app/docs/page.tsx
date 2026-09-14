import Link from 'next/link';
import { DocsShell } from '@/components/docs/docs-shell';
import { docsCategories, getDocsArticlesByCategory } from '@/lib/docs-data';

export default function DocsHomePage() {
  return (
    <DocsShell>
      <div className="rounded-2xl border border-border-light bg-white p-8 tablet-up:p-12">
        <p className="font-display text-sm uppercase tracking-[0.2em] text-appweaver-orange">
          Documentation
        </p>
        <h1 className="mt-3 font-display text-[36px] leading-none tracking-[-1.4px] text-text-agent-heading tablet-up:text-[48px]">
          Welcome to AppWeaver AI docs
        </h1>
        <p className="mt-4 max-w-[620px] font-display text-lg leading-snug text-text-dim">
          Learn how AppWeaver AI turns a plain-language prompt into a working,
          published app — from your first project to inviting a team and
          going live on a custom domain.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/docs/welcome"
            className="rounded-full bg-appweaver-orange px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-appweaver-orange/90">
            Start reading
          </Link>
          <Link
            href="/docs/first-project"
            className="rounded-full border border-border-light bg-white px-5 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-dim">
            Your first project
          </Link>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-6 tablet-up:grid-cols-2">
        {docsCategories.map((category) => {
          const articles = getDocsArticlesByCategory(category.id);
          return (
            <div
              key={category.id}
              className="rounded-2xl border border-border-light bg-white p-6">
              <h2 className="font-display text-lg text-text-agent-heading">
                {category.title}
              </h2>
              <ul className="mt-3 space-y-2">
                {articles.map((article) => (
                  <li key={article.slug}>
                    <Link
                      href={`/docs/${article.slug}`}
                      className="text-sm text-text-secondary underline-offset-2 hover:text-text-primary hover:underline">
                      {article.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {article.summary}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </DocsShell>
  );
}


