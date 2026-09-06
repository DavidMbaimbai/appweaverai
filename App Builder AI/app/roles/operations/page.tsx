import { ProductPage } from '@/components/marketing/product-page';

export default function OperationsRolePage() {
  return (
    <ProductPage
      eyebrow="Roles"
      title="AppWeaver AI for Operations"
      description="Build the internal tools your team actually needs — trackers, approval flows, and dashboards — without filing a ticket and waiting on engineering."
      highlights={[
        {
          title: "Replace manual work",
          description:
            "Turn a spreadsheet-and-email process into a real app with forms and notifications.",
        },
        {
          title: "Approval workflows",
          description:
            "Build multi-step approval flows tailored to how your team actually operates.",
        },
        {
          title: "Live dashboards",
          description:
            "Track the operational metrics that matter without exporting data by hand.",
        },
        {
          title: "Own your tools",
          description:
            "Maintain and evolve internal tools yourself instead of depending on another team.",
        },
      ]}
    />
  );
}

