import { ProductPage } from '@/components/marketing/product-page';

export default function ExpertsPage() {
  return (
    <ProductPage
      eyebrow="Resources"
      title="Expert Network"
      description="Get hands-on help from vetted experts when you need a second set of hands on architecture, design, or a tricky integration."
      highlights={[
        {
          title: "Book an expert",
          description:
            "Schedule time with someone experienced in the exact problem you are solving.",
        },
        {
          title: "Architecture reviews",
          description:
            "Get a second opinion before you scale a project past the prototype stage.",
        },
        {
          title: "Hands-on help",
          description:
            "Bring in extra help for a sprint without hiring a full-time engineer.",
        },
        {
          title: "Vetted specialists",
          description:
            "Every expert is reviewed for depth of experience building on AppWeaver AI.",
        },
      ]}
    />
  );
}

