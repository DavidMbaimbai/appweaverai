import { ProductPage } from '@/components/marketing/product-page';

export default function SmbRolePage() {
  return (
    <ProductPage
      eyebrow="Roles"
      title="AppWeaver AI for Small Business Owners"
      description="Build the website, booking system, or customer tool your business needs — without hiring a developer or learning to code."
      highlights={[
        {
          title: "No coding required",
          description:
            "Describe what you want in plain language and get a working app back.",
        },
        {
          title: "Affordable to start",
          description:
            "Launch on a free plan and upgrade only when your business is ready to scale.",
        },
        {
          title: "Own your website",
          description:
            "Publish a site or app under your own domain without an agency retainer.",
        },
        {
          title: "Update it yourself",
          description:
            "Make changes anytime by describing what you want changed — no developer needed.",
        },
      ]}
    />
  );
}

