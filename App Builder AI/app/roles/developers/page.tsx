import { ProductPage } from '@/components/marketing/product-page';

export default function DevelopersRolePage() {
  return (
    <ProductPage
      eyebrow="Roles"
      title="AppWeaver AI for Software Developers"
      description="Use Agent 4 as a force multiplier — offload scaffolding, boilerplate, and repetitive implementation work so you can focus on the hard problems."
      highlights={[
        {
          title: "Skip the boilerplate",
          description:
            "Let the Agent handle auth, CRUD routes, and database schemas so you start from real code.",
        },
        {
          title: "Parallel execution",
          description:
            "Run several agents on different parts of your codebase and review the diffs before merging.",
        },
        {
          title: "Full code access",
          description:
            "Every generated file is real, editable code — no black-box output you can't inspect.",
        },
        {
          title: "Bring your stack",
          description:
            "Import an existing GitHub repo and keep building on it with the Agent's help.",
        },
      ]}
    />
  );
}

