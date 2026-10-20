import Link from 'next/link';

import { Container } from '@/components/ui/container';
import { footerColumns } from '@/lib/landing-data';

import { AppWeaverLogo } from '../ui/appweaver-logo';

const legalTitles = new Set(['Legal']);
const socialTitle = 'Connect';

export function Footer() {
  const columns = footerColumns.filter((c) => c.title !== socialTitle);
  const social = footerColumns.find((c) => c.title === socialTitle)?.links ?? [];

  return (
    <div className="border-t border-border-light/60 bg-background">
      <Container as="footer" className="py-12">
        <div className="flex flex-col items-start justify-between gap-6 rounded-3xl border border-border-light bg-surface-white p-8 desktop:flex-row desktop:items-center">
          <div className="max-w-xl">
            <h2 className="text-2xl font-semibold text-text-primary">
              From idea to launched business, in one workspace.
            </h2>
            <p className="mt-2 text-sm text-text-muted">
              Build the product, publish it, market it, support your customers and
              find investors without leaving AppWeaver AI.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-full bg-text-primary px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90">
            Start building free
          </Link>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-8 tablet-up:grid-cols-4 desktop:grid-cols-5">
          <div className="col-span-2 tablet-up:col-span-4 desktop:col-span-1">
            <Link href="/" className="inline-block text-text-primary" aria-label="AppWeaver AI">
              <AppWeaverLogo />
            </Link>
            <p className="mt-4 text-base font-semibold text-text-primary">
              Build. Launch. Market. Grow. All with AI.
            </p>
            <p className="mt-2 max-w-xs text-sm text-text-muted">
              From your first idea to your next big opportunity, AppWeaver AI helps you build
              products, reach customers and grow your business.
            </p>
            <p className="mt-3 text-sm text-text-secondary">
              <span aria-hidden="true">🇿🇦</span> Made in South Africa
            </p>
          </div>

          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h3 className="mb-4 text-xs font-semibold text-text-primary">{column.title}</h3>
              <ul className="space-y-2.5">
                {(column.links ?? []).map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className={`text-sm transition-colors hover:text-text-primary ${
                        legalTitles.has(column.title) ? 'text-text-muted' : 'text-text-secondary'
                      }`}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-border-light/60 pt-6 tablet-up:flex-row tablet-up:items-center">
          <p className="text-xs text-text-dim">
            &copy; {new Date().getFullYear()} AppWeaver AI. All rights reserved.
          </p>
          <ul className="flex flex-wrap gap-2">
            {social.map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-border-light px-3 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </div>
  );
}
