import { ProductPage } from '@/components/marketing/product-page';

export default function MobileUseCasePage() {
  return (
    <ProductPage
      eyebrow="Use Case"
      title="Mobile apps without a mobile team"
      description="From idea to installable app — describe the experience you want and let Agent 4 handle screens, navigation, and the backend behind them."
      highlights={[
        {
          title: "Consumer apps",
          description:
            "Launch a fitness tracker, marketplace, or social app without hiring iOS and Android engineers.",
        },
        {
          title: "Companion apps",
          description:
            "Extend an existing product with a mobile experience that shares the same data.",
        },
        {
          title: "Rapid iteration",
          description:
            "Test an idea with real users on real devices in days, not months.",
        },
        {
          title: "One codebase",
          description:
            "Your mobile and web experiences stay in sync because they share the same project.",
        },
      ]}
    />
  );
}
