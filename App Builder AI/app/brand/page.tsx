import { ProductPage } from '@/components/marketing/product-page';

export default function BrandPage() {
  return (
    <ProductPage
      eyebrow="Company"
      title="Brand guidelines"
      description="Logos, colors, and usage guidelines for referencing AppWeaver AI in press, integrations, or community content."
      highlights={[
        {
          title: "Logo usage",
          description:
            "Download approved logo files and see spacing and sizing guidelines.",
        },
        {
          title: "Color palette",
          description:
            "Our signature orange and the supporting neutral palette used across the brand.",
        },
        {
          title: "Typography",
          description:
            "The display and body typefaces used across our product and marketing.",
        },
        {
          title: "Do's and don'ts",
          description:
            "Guidance on how not to modify or misrepresent the AppWeaver AI brand.",
        },
      ]}
    />
  );
}
