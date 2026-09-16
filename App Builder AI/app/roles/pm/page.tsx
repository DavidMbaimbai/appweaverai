import { RolePage } from '@/components/marketing/role-page';

export default function PmRolePage() {
  return (
    <RolePage
      title="AppWeaver AI for Product Managers"
      description="Turn a spec into a working prototype yourself, validate ideas with real software, and give engineering a clearer starting point."
      forWhom="Product managers who need to explore workflows, prove value, and align stakeholders before a full engineering cycle starts."
      canBuild={[
        'Clickable product prototypes for discovery calls and user tests.',
        'Internal MVPs that demonstrate a new workflow end to end.',
        'Demo-ready feature concepts for roadmap reviews.',
      ]}
      capabilities={[
        'Prompt-to-app generation for fast first drafts.',
        'Live preview and visual editing for quick copy and layout changes.',
        'Publishing so stakeholders can test a real link.',
        'Version history and project workspaces for iteration.',
      ]}
      workflow={[
        'Write the user problem and desired flow in plain language.',
        'Review the generated app, then refine screens and data fields.',
        'Share a published prototype with users or stakeholders.',
        'Use feedback to revise the prompt or hand the working app to engineering.',
      ]}
      benefits={[
        'De-risk roadmap bets before committing a sprint.',
        'Replace static mockups with realistic, interactive experiences.',
        'Run more discovery experiments with less engineering dependency.',
      ]}
    />
  );
}
