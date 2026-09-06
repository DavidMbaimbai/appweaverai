import { ProductPage } from '@/components/marketing/product-page';

export default function AdditionalResourcesPage() {
  return (
    <ProductPage
      eyebrow="Company"
      title="Additional resources"
      description="More ways to learn about and get the most out of AppWeaver AI, from templates to in-depth guides."
      highlights={[
        {
          title: "Template library",
          description:
            "Starting points for common project types like dashboards and landing pages.",
        },
        {
          title: "Video walkthroughs",
          description:
            "Watch short videos covering the most useful features end to end.",
        },
        {
          title: "API reference",
          description:
            "Technical reference for teams integrating deeper with the platform.",
        },
        {
          title: "Changelog",
          description:
            "A running log of everything shipped, big and small.",
        },
      ]}
    />
  );
}
