import { RolePage } from '@/components/marketing/role-page';

export default function DesignersRolePage() {
  return (
    <RolePage
      title="AppWeaver AI for Designers"
      description="Move from a design idea to a working app without losing intent in handoff. Explore layouts, flows, and content in the product itself."
      forWhom="Product and brand designers who want to test interaction, responsiveness, and real content instead of stopping at static screens."
      canBuild={[
        'Responsive landing pages and onboarding flows.',
        'Interactive product prototypes with real navigation.',
        'Design system examples that engineering can inspect as code.',
      ]}
      capabilities={[
        'Visual editing for copy, spacing, and layout refinements.',
        'Reusable components that keep generated screens consistent.',
        'Live preview across app surfaces.',
        'Published links for critique and stakeholder review.',
      ]}
      workflow={[
        'Describe the experience, visual direction, and audience.',
        'Use the preview to adjust hierarchy, copy, and responsive behavior.',
        'Generate alternate directions while keeping the best one.',
        'Share the working prototype for feedback or implementation review.',
      ]}
      benefits={[
        'Reduce the gap between design intent and shipped UI.',
        'Validate interaction and responsiveness earlier.',
        'Give teams a working reference instead of another static artifact.',
      ]}
    />
  );
}
