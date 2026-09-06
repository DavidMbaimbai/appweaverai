import { ProductPage } from '@/components/marketing/product-page';

export default function ProPage() {
  return (
    <ProductPage
      eyebrow="AppWeaver AI Pro"
      title="For commercial and professional builds"
      description="Everything in Core, plus more monthly credits, more collaborators, and access to the most powerful models — built for teams shipping real products."
      highlights={[
        {
          title: '$100 monthly credits',
          description:
            'More room to build, iterate, and ship without worrying about running out mid-project.',
        },
        {
          title: 'Invite your team',
          description:
            'Bring up to 15 collaborators and 50 viewers into your workspace to build together.',
        },
        {
          title: 'Parallel agents',
          description:
            'Work in parallel with up to 10 agents so multiple parts of your app move forward at once.',
        },
        {
          title: 'Database rollbacks',
          description:
            'Roll your database back up to 28 days if something needs to be undone.',
        },
      ]}
      ctaLabel="Upgrade to Pro"
      ctaHref="/app/billing"
    />
  );
}

