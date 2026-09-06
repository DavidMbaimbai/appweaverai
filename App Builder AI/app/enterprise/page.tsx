import { ProductPage } from '@/components/marketing/product-page';

export default function EnterprisePage() {
  return (
    <ProductPage
      eyebrow="Enterprise"
      title="Secure your apps as they scale"
      description="Enterprise-grade security controls, single-tenant environments, and dedicated support for organizations building at scale on AppWeaver AI."
      highlights={[
        {
          title: 'SSO / SAML',
          description:
            'Bring your existing identity provider so employees sign in the way they already do.',
        },
        {
          title: 'Advanced privacy controls',
          description:
            'Fine-grained permissions and admin controls keep sensitive projects locked down.',
        },
        {
          title: 'Single-tenant environments',
          description:
            'Run in an isolated environment with static outbound IPs and VPC peering support.',
        },
        {
          title: 'Custom seat limits',
          description:
            'Scale licensing to match your organization instead of fitting a fixed plan.',
        },
      ]}
      ctaLabel="Contact sales"
      ctaHref="/contact-sales"
    />
  );
}

