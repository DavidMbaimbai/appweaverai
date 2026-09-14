import { ProductPage } from '@/components/marketing/product-page';
import { SalesContactCta } from '@/components/marketing/sales-contact-cta';

export default function ContactSalesPage() {
  return (
    <ProductPage
      eyebrow="Contact Sales"
      title="Let's talk about your team"
      description="Tell us about what you're building and how big your team is, and we'll help you find the right plan — from a few collaborators to enterprise-wide rollout."
      highlights={[
        {
          title: "Custom seat plans",
          description:
            "Pricing that scales with the number of builders and viewers on your team.",
        },
        {
          title: "Enterprise security",
          description:
            "SSO/SAML, advanced privacy controls, and single-tenant environments on request.",
        },
        {
          title: "Onboarding support",
          description:
            "Dedicated help getting your team set up and productive quickly.",
        },
        {
          title: "Response within a day",
          description:
            "A member of our team will follow up with next steps after you reach out.",
        },
      ]}
      ctaSlot={<SalesContactCta label="Email sales" />}
    />
  );
}
