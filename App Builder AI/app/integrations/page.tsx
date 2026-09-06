import { ProductPage } from '@/components/marketing/product-page';

export default function IntegrationsPage() {
  return (
    <ProductPage
      eyebrow="Integrations"
      title="Connect to AI & services"
      description="Enhance your apps with best-in-class AI models and over 100 integrations. Connect to payments, email, storage, and more in minutes — no glue code required."
      highlights={[
        {
          title: 'AI models',
          description:
            'Bring the latest language and image models into your app with a single connection.',
        },
        {
          title: 'Payments & billing',
          description:
            'Add checkout, subscriptions, and invoicing without writing a payment integration from scratch.',
        },
        {
          title: 'Productivity tools',
          description:
            'Sync with calendars, docs, and workspace tools your team already uses every day.',
        },
        {
          title: 'Open by design',
          description:
            'Add new integrations as your app grows — nothing is locked to a single provider.',
        },
      ]}
    />
  );
}
