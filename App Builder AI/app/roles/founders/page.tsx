import { ProductPage } from '@/components/marketing/product-page';

export default function FoundersRolePage() {
  return (
    <ProductPage
      eyebrow="Roles"
      title="AppWeaver AI for Founders"
      description="Go from idea to working MVP fast enough to start talking to users this week, not next quarter — without a co-founding engineer."
      highlights={[
        {
          title: "Ship an MVP solo",
          description:
            "Build a real, working product to validate your idea before raising or hiring.",
        },
        {
          title: "Talk to users sooner",
          description:
            "Put a working app in front of customers instead of a pitch deck or landing page.",
        },
        {
          title: "Iterate on feedback",
          description:
            "Change direction quickly as you learn what your early users actually want.",
        },
        {
          title: "Grow when ready",
          description:
            "Scale the same project into production as your business grows — no rebuild required.",
        },
      ]}
    />
  );
}

