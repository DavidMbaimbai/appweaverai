import { RolePage } from '@/components/marketing/role-page';

export default function FoundersRolePage() {
  return (
    <RolePage
      title="AppWeaver AI for Founders"
      description="Go from idea to MVP quickly enough to talk to real users this week, then keep iterating as the market teaches you."
      forWhom="Founders validating a product idea before hiring a full team or committing months of engineering time."
      canBuild={[
        'MVPs for SaaS, marketplaces, portals, and workflow tools.',
        'Landing pages connected to real product demos.',
        'Investor and customer demos with working flows.',
      ]}
      capabilities={[
        'Prompt-to-app generation for a fast first product.',
        'Built-in auth, database, and publishing scaffolding.',
        'Pricing and billing integration points for paid products.',
        'Project iteration through the Agent as you learn.',
      ]}
      workflow={[
        'Describe the core customer problem and first workflow.',
        'Generate a working MVP and test it yourself.',
        'Publish a link for early users or prospects.',
        'Iterate based on feedback instead of rebuilding from scratch.',
      ]}
      benefits={[
        'Validate demand before raising, hiring, or outsourcing.',
        'Replace pitch-deck assumptions with product evidence.',
        'Keep moving while your team is still small.',
      ]}
    />
  );
}
