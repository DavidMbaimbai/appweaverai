import { ProductPage } from '@/components/marketing/product-page';

export default function StartupsPage() {
  return (
    <ProductPage
      eyebrow="Company"
      title="Startups"
      description="Special credits and support for early-stage startups building their product on AppWeaver AI."
      highlights={[
        {
          title: "Startup credits",
          description:
            "Qualifying startups can apply for extra credits to help build their first product.",
        },
        {
          title: "Built for speed",
          description:
            "Go from idea to a live MVP fast enough to start talking to users this week.",
        },
        {
          title: "Grow with your product",
          description:
            "Scale the same project from prototype to production as your startup grows.",
        },
        {
          title: "Apply now",
          description:
            "Tell us about your startup and we will follow up with eligibility details.",
        },
      ]}
    />
  );
}
