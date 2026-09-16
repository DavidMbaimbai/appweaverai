import { RolePage } from '@/components/marketing/role-page';

export default function DevelopersRolePage() {
  return (
    <RolePage
      title="AppWeaver AI for Software Developers"
      description="Use Agent 4 as a force multiplier for scaffolding, repetitive implementation, and prototype branches while you keep control of the code."
      forWhom="Developers and technical teams who want to move faster without giving up review, architecture, or source-code ownership."
      canBuild={[
        'Feature prototypes with real routes, state, and data models.',
        'Admin dashboards, CRUD tools, and integration proofs of concept.',
        'Production-ready starting points for apps and websites.',
      ]}
      capabilities={[
        'Editable generated source files.',
        'Agent task planning and step-by-step activity.',
        'Project file inspection and live preview.',
        'Built-in auth, database, publishing, and billing scaffolding.',
      ]}
      workflow={[
        'Give the Agent a scoped implementation task.',
        'Inspect generated files and preview the behavior.',
        'Ask for targeted revisions or continue manually.',
        'Publish or export once the implementation passes review.',
      ]}
      benefits={[
        'Spend less time on boilerplate and more time on architecture.',
        'Prototype integration paths before committing to a full build.',
        'Keep human review in the loop for every meaningful change.',
      ]}
    />
  );
}
