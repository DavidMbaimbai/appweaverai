import { ProductPage } from '@/components/marketing/product-page';

export default function StoriesPage() {
  return (
    <ProductPage
      eyebrow="Resources"
      title="Customer Stories"
      description="Real teams building real products on AppWeaver AI — see how founders, product teams, and enterprises use the platform every day."
      highlights={[
        {
          title: "Startups",
          description:
            "See how early-stage teams ship an MVP and start talking to users in days.",
        },
        {
          title: "Product teams",
          description:
            "Learn how product managers prototype and validate features before a full build.",
        },
        {
          title: "Enterprises",
          description:
            "Explore how larger organizations roll out AppWeaver AI across multiple teams.",
        },
        {
          title: "Share your story",
          description:
            "Built something you are proud of? We would love to feature it here.",
        },
      ]}
    />
  );
}

