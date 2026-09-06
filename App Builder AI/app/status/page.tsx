import { ProductPage } from '@/components/marketing/product-page';

export default function StatusPage() {
  return (
    <ProductPage
      eyebrow="Handy Links"
      title="System Status"
      description="Live status and uptime history for AppWeaver AI's core services — the Agent, hosting, database, and authentication."
      highlights={[
        {
          title: "All systems operational",
          description:
            "Agent, hosting, database, and authentication are running normally.",
        },
        {
          title: "Incident history",
          description:
            "See past incidents, their impact, and how quickly they were resolved.",
        },
        {
          title: "Scheduled maintenance",
          description:
            "Planned maintenance windows are posted here in advance.",
        },
        {
          title: "Subscribe to updates",
          description:
            "Get notified by email whenever there is a change in system status.",
        },
      ]}
    />
  );
}
