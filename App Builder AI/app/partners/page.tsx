import { ProductPage } from '@/components/marketing/product-page';

export default function PartnersPage() {
  return (
    <ProductPage
      eyebrow="Resources"
      title="Partners"
      description="We work with technology and agency partners to help teams build, launch, and scale faster on AppWeaver AI."
      highlights={[
        {
          title: "Technology partners",
          description:
            "Integration partners bring their services directly into the AppWeaver AI building experience.",
        },
        {
          title: "Agency partners",
          description:
            "Work with vetted agencies who build production apps for clients on AppWeaver AI.",
        },
        {
          title: "Become a partner",
          description:
            "If you build tools or services developers rely on, we would love to talk.",
        },
        {
          title: "Co-marketing",
          description:
            "Qualified partners can collaborate with us on joint launches and case studies.",
        },
      ]}
    />
  );
}

