import { ProductPage } from '@/components/marketing/product-page';

export default function VibeCodingPage() {
  return (
    <ProductPage
      eyebrow="Handy Links"
      title="Vibe Coding 101"
      description="A quick primer on describing what you want in plain language and letting Agent 4 turn it into working software — no prior coding experience required."
      highlights={[
        {
          title: "Start with intent",
          description:
            "Describe the outcome you want, not the implementation — the Agent figures out the how.",
        },
        {
          title: "Iterate out loud",
          description:
            "Refine your app by describing changes in follow-up messages, just like talking to a teammate.",
        },
        {
          title: "Review as you go",
          description:
            "Check the live preview after every change so you always know what you're shipping.",
        },
        {
          title: "Learn the shortcuts",
          description:
            "Plan mode, attachments, and templates help you get to a better first draft faster.",
        },
      ]}
    />
  );
}
