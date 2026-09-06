import { ProductPage } from '@/components/marketing/product-page';

export default function EnterpriseRolePage() {
  return (
    <ProductPage
      eyebrow="Roles"
      title="AppWeaver AI for Enterprise"
      description="Give your organization a secure, governed way to turn ideas into internal tools and customer-facing apps, without waiting on a full engineering cycle."
      highlights={[
        {
          title: "Governed by default",
          description:
            "SSO, admin controls, and audit-friendly workflows keep every project accountable.",
        },
        {
          title: "Faster delivery",
          description:
            "Reduce the time from request to working software across every department.",
        },
        {
          title: "Central oversight",
          description:
            "Admins can see every workspace and project across the organization in one place.",
        },
        {
          title: "Enterprise support",
          description:
            "Dedicated support and onboarding help your teams adopt AppWeaver AI with confidence.",
        },
      ]}
      ctaLabel="Contact sales"
      ctaHref="/contact-sales"
    />
  );
}

