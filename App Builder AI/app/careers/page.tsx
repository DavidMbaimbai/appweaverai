import { ProductPage } from '@/components/marketing/product-page';

export default function CareersPage() {
  return (
    <ProductPage
      eyebrow="Company"
      title="Careers"
      description="We're a small team building tools that change how software gets made. If that excites you, we'd love to hear from you."
      highlights={[
        {
          title: "How we work",
          description:
            "Small teams, fast iteration, and a bias toward shipping over planning.",
        },
        {
          title: "Open roles",
          description:
            "Check back for open positions across engineering, design, and go-to-market.",
        },
        {
          title: "Remote-friendly",
          description:
            "We hire great people wherever they are and support flexible working.",
        },
        {
          title: "Get in touch",
          description:
            "Don't see a role that fits? Reach out anyway — we're always meeting people.",
        },
      ]}
    />
  );
}
