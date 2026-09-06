import { ProductPage } from '@/components/marketing/product-page';

export default function AgentPage() {
  return (
    <ProductPage
      eyebrow="Agent"
      title="Meet Agent 4, your AI builder"
      description="Describe what you want in plain language and Agent 4 plans, writes, tests, and iterates on real, working code — handling auth, data, and design so you don't have to."
      highlights={[
        {
          title: 'Infinite Canvas',
          description:
            'Explore and tweak designs visually, then apply them directly to your app without leaving the flow.',
        },
        {
          title: 'Parallel Agents',
          description:
            'Run multiple tasks at once — auth, database, and design move forward together with full visibility.',
        },
        {
          title: 'Multiple Artifacts',
          description:
            'Create mobile and web apps, landing pages, and more in one project with a shared design system.',
        },
        {
          title: 'Built for Teams',
          description:
            'Submit requests in any order — Agent 4 sequences and executes them intelligently for the whole team.',
        },
      ]}
    />
  );
}
