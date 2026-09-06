import { ProductPage } from '@/components/marketing/product-page';

export default function GuidesPage() {
  return (
    <ProductPage
      eyebrow="Handy Links"
      title="How-to guides"
      description="Step-by-step walkthroughs for common tasks — from your first prompt to connecting a database, inviting collaborators, and publishing your app."
      highlights={[
        {
          title: "Your first project",
          description:
            "A walkthrough of writing a prompt, reviewing the plan, and getting your first working app.",
        },
        {
          title: "Working with data",
          description:
            "Add tables, relationships, and seed data to the built-in database.",
        },
        {
          title: "Inviting your team",
          description:
            "Add collaborators to a workspace and manage what they can see and edit.",
        },
        {
          title: "Going live",
          description:
            "Publish your project and connect a custom domain when you are ready to launch.",
        },
      ]}
    />
  );
}
