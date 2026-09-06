import { ProductPage } from '@/components/marketing/product-page';

export default function DesignPage() {
  return (
    <ProductPage
      eyebrow="Design"
      title="Design freely, ship instantly"
      description="A visual canvas lets you explore layouts, colors, and components, then apply your changes straight to the running app — no separate design tool required."
      highlights={[
        {
          title: 'Visual editing',
          description:
            'Click any element in the live preview and adjust spacing, color, and copy with instant feedback.',
        },
        {
          title: 'Design system built-in',
          description:
            'Every generated app shares a consistent set of components, so pages stay visually cohesive as they grow.',
        },
        {
          title: 'From sketch to screen',
          description:
            'Turn a rough idea or reference image into a polished, responsive UI in minutes.',
        },
        {
          title: 'Reusable templates',
          description:
            'Start from proven layouts for dashboards, landing pages, and mobile screens instead of a blank canvas.',
        },
      ]}
    />
  );
}
