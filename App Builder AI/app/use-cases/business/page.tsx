import { ProductPage } from '@/components/marketing/product-page';

export default function BusinessUseCasePage() {
  return (
    <ProductPage
      eyebrow="Use Case"
      title="Business apps, built in an afternoon"
      description="Internal tools, customer portals, and back-office dashboards — describe the workflow and Agent 4 builds the app your business actually needs."
      highlights={[
        {
          title: "Internal tools",
          description:
            "Replace spreadsheets and one-off scripts with a real app your whole team can use.",
        },
        {
          title: "Customer portals",
          description:
            "Give clients a place to submit requests, track status, and upload files securely.",
        },
        {
          title: "Ops dashboards",
          description:
            "Turn raw data into a dashboard that tracks the metrics your team checks every day.",
        },
        {
          title: "No IT backlog",
          description:
            "Ship the small tools that never make it to the top of the engineering queue.",
        },
      ]}
    />
  );
}
