import { ProductPage } from '@/components/marketing/product-page';

export default function PublishPage() {
  return (
    <ProductPage
      eyebrow="Publish Apps"
      title="Describe it. Publish it."
      description="Go from a prompt to a live, shareable URL in one click. Hosting, SSL, and scaling are handled for you, so publishing is as simple as building."
      highlights={[
        {
          title: 'One-click deploys',
          description:
            'Publish your project the moment it is ready — no build pipelines or servers to configure.',
        },
        {
          title: 'Custom domains',
          description:
            'Point your own domain at a published app and keep your branding consistent everywhere.',
        },
        {
          title: 'Private or public',
          description:
            'Choose password-protected, invite-only, or fully public deployments depending on the project.',
        },
        {
          title: 'Always up to date',
          description:
            'Re-publish anytime the Agent makes changes, keeping your live app in sync with your latest edits.',
        },
      ]}
    />
  );
}
