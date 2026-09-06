import { ProductPage } from '@/components/marketing/product-page';

export default function HelpPage() {
  return (
    <ProductPage
      eyebrow="Handy Links"
      title="Help Center"
      description="Find answers to common questions about billing, projects, and the Agent, or reach out to support if you're stuck."
      highlights={[
        {
          title: "Getting started",
          description:
            "Answers to the most common questions when you are new to AppWeaver AI.",
        },
        {
          title: "Billing & plans",
          description:
            "Understand credits, seats, and how to change or cancel your plan.",
        },
        {
          title: "Troubleshooting",
          description:
            "Fixes for common issues with previews, publishing, and integrations.",
        },
        {
          title: "Contact support",
          description:
            "Can't find what you need? Reach out and a real person will help.",
        },
      ]}
    />
  );
}
