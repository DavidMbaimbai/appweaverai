import { ProductPage } from '@/components/marketing/product-page';

export default function RaceToRevenuePage() {
  return (
    <ProductPage
      eyebrow="Company"
      title="Race to Revenue"
      description="A program celebrating builders who go from an idea on AppWeaver AI to their first paying customer."
      highlights={[
        {
          title: "Build in public",
          description:
            "Share your progress as you take a project from prompt to paying customers.",
        },
        {
          title: "Community support",
          description:
            "Get feedback and encouragement from other builders on the same journey.",
        },
        {
          title: "Milestones & prizes",
          description:
            "Hit revenue milestones to unlock recognition and rewards from the team.",
        },
        {
          title: "Join the race",
          description:
            "Sign up to have your project tracked and featured as you grow.",
        },
      ]}
    />
  );
}
