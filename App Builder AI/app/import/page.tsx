import { ProductPage } from '@/components/marketing/product-page';
import { DesignImportTabs } from '@/components/import/design-import-tabs';

export default function ImportPage() {
  return (
    <ProductPage
      eyebrow="Handy Links"
      title="Import a design or project"
      description="Start from Figma, a website or a screenshot — or import an existing GitHub repository (including projects from Lovable and other builders) and keep building with App Weaver AI."
      ctaSlot={<DesignImportTabs />}
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
