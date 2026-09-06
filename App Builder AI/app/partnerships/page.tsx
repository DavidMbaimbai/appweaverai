import { ProductPage } from '@/components/marketing/product-page';

export default function PartnershipsPage() {
  return (
    <ProductPage
      eyebrow="Company"
      title="Partnerships"
      description="We partner with technology providers, agencies, and educators to help more people build with AppWeaver AI."
      highlights={[
        {
          title: "Technology partners",
          description:
            "Bring your API or service directly into the AppWeaver AI building experience.",
        },
        {
          title: "Agency partners",
          description:
            "Build client projects on AppWeaver AI and get access to partner resources.",
        },
        {
          title: "Education partners",
          description:
            "Bring AppWeaver AI into classrooms and bootcamps to teach modern app building.",
        },
        {
          title: "Start a conversation",
          description:
            "Reach out through Contact Sales to explore a partnership.",
        },
      ]}
    />
  );
}
