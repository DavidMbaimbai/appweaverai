import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { getMarketingNavUser } from '@/lib/auth/nav-user';

const securitySections = [
  {
    title: 'Authentication',
    description:
      'Customer sign-in is powered by Better Auth with email/password, Google, GitHub, and email verification flows configured in the application.',
  },
  {
    title: 'Admin roles and permissions',
    description:
      'The admin console enforces role-based permissions for users, projects, subscriptions, payments, analytics, security events, audit logs, and settings.',
  },
  {
    title: 'Audit and security events',
    description:
      'Privileged admin actions are written to an audit log, while login, logout, verification, abuse, and security signals are recorded as security events.',
  },
  {
    title: 'Data protection',
    description:
      'Application data is stored through Prisma and PostgreSQL, with server-side access checks around dashboard, project, billing, and admin workflows.',
  },
  {
    title: 'Secrets and environment configuration',
    description:
      'Sensitive keys such as Stripe, OAuth, database, and AI provider credentials are read from server-side environment variables and are not committed to the repository.',
  },
  {
    title: 'Payments and webhook verification',
    description:
      'Stripe checkout, subscriptions, billing portal sessions, refunds, and webhook signature verification are handled server-side.',
  },
  {
    title: 'Publishing controls',
    description:
      'Published projects support visibility states, access checks, and server routes that separate public viewers from authenticated workspace editing.',
  },
  {
    title: 'Enterprise security discussions',
    description:
      'SSO/SAML, advanced privacy controls, dedicated environments, and deployment requirements are handled through the enterprise contact-sales process.',
  },
];

export default async function SecurityPage() {
  const initialUser = await getMarketingNavUser();

  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[60vh] py-16 tablet-up:py-24">
        <Container className="flex flex-col items-center gap-6 text-center">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-appweaver-orange">
            Security
          </p>
          <h1 className="font-display text-[40px] leading-none tracking-[-1.6px] text-text-agent-heading tablet-up:text-[56px]">
            Secure foundations for building and publishing apps
          </h1>
          <p className="max-w-[720px] font-display text-lg leading-snug text-text-dim">
            AppWeaver AI combines authenticated workspaces, server-side
            authorization, admin oversight, audit trails, and verified payment
            webhooks to keep public and private app workflows controlled.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            <Button href="/contact-sales" className="h-[45px] px-6">
              Contact sales
            </Button>
            <Button
              href="/privacy"
              variant="outline"
              className="h-[45px] px-6">
              View privacy policy
            </Button>
          </div>
        </Container>

        <Container className="mt-16 grid grid-cols-1 gap-4 tablet-up:mt-20 tablet-up:grid-cols-2">
          {securitySections.map((section) => (
            <section
              key={section.title}
              className="rounded-[20px] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
              <h2 className="font-display text-xl tracking-[-0.02em] text-text-agent-heading">
                {section.title}
              </h2>
              <p className="mt-2 font-display text-base leading-snug text-text-dim">
                {section.description}
              </p>
            </section>
          ))}
        </Container>

        <Container className="mt-16 max-w-[780px] tablet-up:mt-20">
          <section className="rounded-[20px] border border-border-light bg-surface-white p-6">
            <h2 className="font-display text-2xl tracking-[-0.02em] text-text-agent-heading">
              Compliance note
            </h2>
            <p className="mt-3 font-display text-base leading-relaxed text-text-dim">
              This page describes AppWeaver AI application capabilities visible
              in the current product. It does not claim SOC 2, ISO 27001,
              HIPAA, GDPR certification, or other formal attestations. Teams
              with procurement or security review requirements should contact
              sales so we can discuss the exact controls and documentation
              needed for their rollout.
            </p>
          </section>
        </Container>
      </main>
      <Footer />
    </>
  );
}
