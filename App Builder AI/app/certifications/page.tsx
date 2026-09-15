import { ProductPage } from '@/components/marketing/product-page';

export default function CertificationsPage() {
  return (
    <ProductPage
      eyebrow="Company"
      title="Security and compliance review"
      description="AppWeaver AI can support enterprise security and procurement conversations, but this page does not claim formal certifications that are not represented in the current product."
      highlights={[
        {
          title: 'Application controls',
          description:
            'Authentication, admin permissions, audit logs, security events, and server-side access checks are implemented in the application.',
        },
        {
          title: 'Data privacy',
          description:
            'The privacy policy explains how account, project, billing, and support data are handled.',
        },
        {
          title: 'Enterprise review',
          description:
            'Teams can request security and deployment details through Contact Sales before rollout.',
        },
        {
          title: 'No unsupported claims',
          description:
            'We do not claim SOC 2, ISO 27001, HIPAA, or other certifications here unless they are formally available.',
        },
      ]}
      ctaLabel="Contact sales"
      ctaHref="/contact-sales"
    />
  );
}
