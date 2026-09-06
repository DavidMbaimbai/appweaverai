import { ProductPage } from '@/components/marketing/product-page';

export default function AboutPage() {
  return (
    <ProductPage
      eyebrow="Company"
      title="About AppWeaver AI"
      description="We're building the fastest way to go from an idea to a real, working app — powered by an AI agent that plans, writes, and ships production-ready code."
      highlights={[
        {
          title: "Our mission",
          description:
            "Make building software as easy as describing what you want.",
        },
        {
          title: "How we got here",
          description:
            "Founded to close the gap between an idea and a working product.",
        },
        {
          title: "Our team",
          description:
            "A small, product-focused team obsessed with making the Agent feel effortless.",
        },
        {
          title: "Where we're headed",
          description:
            "More powerful agents, deeper integrations, and faster time to a shipped app.",
        },
      ]}
    />
  );
}
