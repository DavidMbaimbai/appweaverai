import { ProductPage } from '@/components/marketing/product-page';

export default function CommunityPage() {
  return (
    <ProductPage
      eyebrow="Resources"
      title="Community"
      description="Join thousands of builders sharing projects, asking questions, and learning from each other's AppWeaver AI apps."
      highlights={[
        {
          title: "Show and tell",
          description:
            "Share what you built and get feedback from other builders in the community.",
        },
        {
          title: "Ask questions",
          description:
            "Get unstuck faster by asking people who have solved the same problem before.",
        },
        {
          title: "Discover projects",
          description:
            "Browse what others are building for inspiration on your next project.",
        },
        {
          title: "Events & meetups",
          description:
            "Join community calls and local meetups to connect with builders near you.",
        },
      ]}
    />
  );
}

