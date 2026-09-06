import { ProductPage } from '@/components/marketing/product-page';

export default function BlogPage() {
  return (
    <ProductPage
      eyebrow="Resources"
      title="Blog"
      description="Product updates, engineering deep dives, and stories from the AppWeaver AI team and community."
      highlights={[
        {
          title: "Product updates",
          description:
            "Stay up to date with new features, models, and integrations as they ship.",
        },
        {
          title: "Engineering deep dives",
          description:
            "Learn how Agent 4 plans and executes tasks under the hood.",
        },
        {
          title: "Builder spotlights",
          description:
            "Read interviews with founders and teams building on AppWeaver AI.",
        },
        {
          title: "Best practices",
          description:
            "Tips for writing better prompts and structuring larger projects.",
        },
      ]}
    />
  );
}

