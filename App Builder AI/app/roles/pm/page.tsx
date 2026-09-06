import { ProductPage } from '@/components/marketing/product-page';

export default function PmRolePage() {
  return (
    <ProductPage
      eyebrow="Roles"
      title="AppWeaver AI for Product Managers"
      description="Turn a spec into a working prototype yourself — validate ideas with real, clickable software instead of static mockups, without waiting on engineering."
      highlights={[
        {
          title: "Spec to prototype",
          description:
            "Describe the feature you're planning and get something real to react to the same day.",
        },
        {
          title: "Stakeholder-ready demos",
          description:
            "Share a live link in your next review instead of a slide deck of screenshots.",
        },
        {
          title: "De-risk the roadmap",
          description:
            "Validate assumptions before committing an engineering team to a full build.",
        },
        {
          title: "Faster discovery",
          description:
            "Run more experiments per quarter by removing the cost of building a first version.",
        },
      ]}
    />
  );
}

