import { ProductPage } from '@/components/marketing/product-page';

export default function MobilePage() {
  return (
    <ProductPage
      eyebrow="Mobile"
      title="Build mobile apps from a single prompt"
      description="Describe a mobile experience and get a working, installable app — sharing the same design system and backend as your web project."
      highlights={[
        {
          title: 'Native-feeling UI',
          description:
            'Generated screens follow mobile interaction patterns, gestures, and navigation out of the box.',
        },
        {
          title: 'Shared backend',
          description:
            'Your mobile app and web app can read and write to the same database and authentication layer.',
        },
        {
          title: 'Preview on device',
          description:
            'Scan a QR code to preview your app on a real phone as the Agent builds it.',
        },
        {
          title: 'Ship to app stores',
          description:
            'Export a build ready for submission when you are ready to publish to iOS or Android.',
        },
      ]}
    />
  );
}
