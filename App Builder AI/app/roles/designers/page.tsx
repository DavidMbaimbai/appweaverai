import { ProductPage } from '@/components/marketing/product-page';

export default function DesignersRolePage() {
  return (
    <ProductPage
      eyebrow="Roles"
      title="AppWeaver AI for Designers"
      description="Move straight from a design idea to a working app on an infinite canvas — no handoff, no waiting for implementation to match your intent."
      highlights={[
        {
          title: "Design in context",
          description:
            "See your changes reflected in a real, running app instead of a static mockup.",
        },
        {
          title: "No lossy handoff",
          description:
            "Skip the gap between design files and shipped code — the design is the app.",
        },
        {
          title: "Fast exploration",
          description:
            "Try multiple visual directions quickly and keep the one that works best.",
        },
        {
          title: "Consistent system",
          description:
            "Reuse a shared component library so every screen you design stays on-brand.",
        },
      ]}
    />
  );
}

