import { ProductPage } from '@/components/marketing/product-page';

export default function GalleryPage() {
  return (
    <ProductPage
      eyebrow="Resources"
      title="Gallery"
      description="Browse real apps built on AppWeaver AI — websites, mobile apps, dashboards, and more — for inspiration on what to build next."
      highlights={[
        {
          title: "Featured builds",
          description:
            "A curated selection of the most impressive projects built on the platform.",
        },
        {
          title: "Browse by category",
          description:
            "Filter by website, mobile, design, animation, and more to find relevant examples.",
        },
        {
          title: "Remix an idea",
          description:
            "Use a gallery project as a starting point and make it your own.",
        },
        {
          title: "Submit your project",
          description:
            "Share what you built and it might be featured for other builders to see.",
        },
      ]}
    />
  );
}

