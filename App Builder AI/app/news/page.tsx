import { ProductPage } from '@/components/marketing/product-page';

export default function NewsPage() {
  return (
    <ProductPage
      eyebrow="Resources"
      title="News"
      description="The latest announcements, press coverage, and milestones from AppWeaver AI."
      highlights={[
        {
          title: "Announcements",
          description:
            "Major product launches and company milestones, straight from the team.",
        },
        {
          title: "Press coverage",
          description:
            "See where AppWeaver AI has been featured in the press and industry publications.",
        },
        {
          title: "Funding & growth",
          description:
            "Updates on company growth, funding, and where the platform is headed next.",
        },
        {
          title: "Media inquiries",
          description:
            "Reporters and press can reach out through our contact page for comment.",
        },
      ]}
    />
  );
}

