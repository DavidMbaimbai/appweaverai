import { ProductPage } from '@/components/marketing/product-page';

export default function DatabasesPage() {
  return (
    <ProductPage
      eyebrow="Databases"
      title="A real database, zero setup"
      description="Every project ships with a built-in, production-grade database — so your app can store users, content, and data from the very first prompt without any manual provisioning."
      highlights={[
        {
          title: 'Zero configuration',
          description:
            'Tables, migrations, and connections are handled automatically as the Agent builds your schema.',
        },
        {
          title: 'Full-stack ready',
          description:
            'Authentication, hosting, and monitoring are wired up alongside your data layer from day one.',
        },
        {
          title: 'Safe rollbacks',
          description:
            'Restore your database to an earlier point in time if a change doesn\'t go the way you expected.',
        },
        {
          title: 'Scales with you',
          description:
            'Start small and grow — the same database backs your app from prototype through production.',
        },
      ]}
    />
  );
}
