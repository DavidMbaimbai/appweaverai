import { ProductPage } from '@/components/marketing/product-page';

export default function CertificationsPage() {
  return (
    <ProductPage
      eyebrow="Company"
      title="Certifications & compliance"
      description="Information on the security certifications and compliance standards AppWeaver AI maintains to keep your data safe."
      highlights={[
        {
          title: "SOC 2",
          description:
            "Independently audited controls around security, availability, and confidentiality.",
        },
        {
          title: "Data privacy",
          description:
            "Practices aligned with common privacy regulations for handling user data.",
        },
        {
          title: "Security reviews",
          description:
            "Regular third-party assessments of our infrastructure and application security.",
        },
        {
          title: "Enterprise requests",
          description:
            "Enterprise customers can request detailed compliance documentation.",
        },
      ]}
    />
  );
}
