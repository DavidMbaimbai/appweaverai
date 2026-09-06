import { ProductPage } from '@/components/marketing/product-page';

export default function ImportPage() {
  return (
    <ProductPage
      eyebrow="Handy Links"
      title="Import from GitHub"
      description="Already have a codebase? Import an existing GitHub repository and keep building on it with Agent 4, instead of starting from a blank prompt."
      highlights={[
        {
          title: "Bring your repo",
          description:
            "Connect a GitHub repository and the Agent reads your existing project structure.",
        },
        {
          title: "Keep your history",
          description:
            "Continue committing to the same repo — nothing about your git history is lost.",
        },
        {
          title: "Understand the codebase",
          description:
            "The Agent maps your existing files before making changes, so edits stay consistent.",
        },
        {
          title: "Two-way sync",
          description:
            "Push changes back to GitHub as you and the Agent iterate together.",
        },
      ]}
    />
  );
}
