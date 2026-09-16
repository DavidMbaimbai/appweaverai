import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { getMarketingNavUser } from '@/lib/auth/nav-user';

const enterpriseCards = [
  {
    title: 'SSO / SAML',
    description:
      'Plan enterprise identity-provider requirements with our sales team so authentication fits your organization.',
  },
  {
    title: 'Advanced privacy controls',
    description:
      'Discuss private workspaces, deployment visibility, and environment needs for sensitive projects.',
  },
  {
    title: 'Admin roles and RBAC',
    description:
      'Use role-based admin permissions for users, projects, payments, subscriptions, analytics, security, audit logs, and settings.',
  },
  {
    title: 'Audit and security events',
    description:
      'Review privileged admin activity and authentication/security signals from the admin console.',
  },
  {
    title: 'Team billing controls',
    description:
      'Manage subscriptions, trials, plan changes, refunds, and customer billing status through server-side Stripe integrations.',
  },
  {
    title: 'Deployment governance',
    description:
      'Control whether published projects are public, private, or workspace-only according to the project workflow.',
  },
];

const workflow = [
  'Map the teams, builders, viewers, and security requirements for rollout.',
  'Confirm identity, privacy, billing, and deployment requirements with sales.',
  'Launch a pilot workspace with representative internal tools or customer apps.',
  'Use admin visibility, audit logs, and support channels as adoption expands.',
];

export default async function EnterprisePage() {
  const initialUser = await getMarketingNavUser();

  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[60vh] py-16 tablet-up:py-24">
        <Container className="flex flex-col items-center gap-6 text-center">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-appweaver-orange">
            Enterprise
          </p>
          <h1 className="font-display text-[40px] leading-none tracking-[-1.6px] text-text-agent-heading tablet-up:text-[56px]">
            Secure your apps as they scale
          </h1>
          <p className="max-w-[720px] font-display text-lg leading-snug text-text-dim">
            Bring AppWeaver AI to teams that need faster software delivery with
            administrative visibility, security review paths, controlled
            publishing, and support for enterprise deployment conversations.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            <Button href="/contact-sales" className="h-[45px] px-6">
              Contact sales
            </Button>
            <Button
              href="/security"
              variant="outline"
              className="h-[45px] px-6">
              Review security
            </Button>
          </div>
        </Container>

        <Container className="mt-16 grid grid-cols-1 gap-4 tablet-up:mt-20 tablet-up:grid-cols-2">
          {enterpriseCards.map((card) => (
            <section
              key={card.title}
              className="rounded-[20px] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
              <h2 className="font-display text-xl tracking-[-0.02em] text-text-agent-heading">
                {card.title}
              </h2>
              <p className="mt-2 font-display text-base leading-snug text-text-dim">
                {card.description}
              </p>
            </section>
          ))}
        </Container>

        <Container className="mt-16 grid grid-cols-1 gap-6 tablet-up:mt-20 tablet-up:grid-cols-[0.9fr_1.1fr]">
          <section>
            <p className="font-display text-sm uppercase tracking-[0.2em] text-appweaver-orange">
              Rollout workflow
            </p>
            <h2 className="mt-3 font-display text-[32px] leading-none tracking-[-1.2px] text-text-agent-heading">
              From pilot to governed adoption
            </h2>
            <p className="mt-4 font-display text-base leading-relaxed text-text-dim">
              Enterprise adoption works best when the first use cases are
              useful, measurable, and reviewed with the right operational
              stakeholders from the start.
            </p>
          </section>
          <ol className="space-y-3">
            {workflow.map((step, index) => (
              <li
                key={step}
                className="rounded-[20px] border border-border-light bg-surface-white p-5 font-display text-base leading-relaxed text-text-dim">
                <span className="mr-3 font-medium text-appweaver-orange">
                  {index + 1}.
                </span>
                {step}
              </li>
            ))}
          </ol>
        </Container>
      </main>
      <Footer />
    </>
  );
}
