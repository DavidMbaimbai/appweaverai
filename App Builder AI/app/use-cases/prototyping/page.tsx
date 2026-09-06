import { ProductPage } from '@/components/marketing/product-page';

export default function PrototypingUseCasePage() {
  return (
    <ProductPage
      eyebrow="Use Case"
      title="Rapid prototyping that feels instant"
      description="Turn a rough idea into a clickable, testable prototype in minutes — perfect for validating concepts before committing engineering time."
      highlights={[
        {
          title: "Clickable prototypes",
          description:
            "Test real user flows like checkout or onboarding before writing production code.",
        },
        {
          title: "Fast feedback loops",
          description:
            "Share a live link with stakeholders and iterate on their feedback the same day.",
        },
        {
          title: "Low-risk experiments",
          description:
            "Try several directions in parallel without committing a full engineering sprint to each.",
        },
        {
          title: "Graduate to production",
          description:
            "Keep building on a validated prototype instead of starting over from scratch.",
        },
      ]}
    />
  );
}
