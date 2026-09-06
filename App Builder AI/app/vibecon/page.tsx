import { ProductPage } from '@/components/marketing/product-page';

export default function VibeconPage() {
  return (
    <ProductPage
      eyebrow="Resources"
      title="Vibecon"
      description="Our annual gathering for builders — talks, workshops, and demos celebrating what the community has built with AppWeaver AI."
      highlights={[
        {
          title: "Talks & workshops",
          description:
            "Learn directly from the team and top builders in the community.",
        },
        {
          title: "Live demos",
          description:
            "See the newest features announced and demoed on stage first.",
        },
        {
          title: "Meet other builders",
          description:
            "Connect with founders, developers, and designers from around the world.",
        },
        {
          title: "Save the date",
          description:
            "Sign up to be notified as soon as tickets and the schedule are announced.",
        },
      ]}
    />
  );
}

