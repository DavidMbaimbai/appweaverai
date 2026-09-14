import Link from 'next/link';
import { AppWeaverLogo } from '../ui/appweaver-logo';
import { Container } from '@/components/ui/container';
import { footerColumns } from '@/lib/landing-data';
import { FooterClock } from './footer-clock';
import { RotatingGlobe } from './rotating-globe';
import { getRecentVerificationLocations } from '@/lib/admin/queries/verification-locations';

export async function Footer() {
  const locations = await getRecentVerificationLocations().catch(() => []);
  const points = locations.map((location) => ({
    lat: location.lat,
    lon: location.lon,
  }));

  return (
    <div className="border-t border-border-light/60 bg-background">
      <Container as="footer" className="py-14">
        <div className="grid grid-cols-2 gap-8 desktop:grid-cols-5 desktop:gap-10">
          <div className="col-span-2 desktop:col-span-1">
            <Link
              href="/"
              className="inline-block text-text-primary"
              aria-label="AppWeaver AI">
              <AppWeaverLogo />
            </Link>

            <div className="mt-8 flex items-center gap-3">
              <RotatingGlobe size={40} points={points} />
              <FooterClock />
            </div>
            <p className="mt-4 text-sm text-text-muted">
              Developed by AppWeaver AI in South Africa.
            </p>
            <p className="mt-6 text-xs text-text-dim">
              All rights reserved. Copyright &copy; {new Date().getFullYear()}{' '}
              AppWeaver AI, Inc.
            </p>
          </div>

          {footerColumns.map((column) => (
            <div key={column.title}>
              <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-text-dim">
                {column.title}
              </h3>
              <ul className="space-y-2.5">
                {(column.links ?? []).map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-text-secondary transition-colors hover:text-text-primary">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Container>
    </div>
  );
}

