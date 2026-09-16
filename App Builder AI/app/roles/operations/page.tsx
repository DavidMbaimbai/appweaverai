import { RolePage } from '@/components/marketing/role-page';

export default function OperationsRolePage() {
  return (
    <RolePage
      title="AppWeaver AI for Operations"
      description="Build the trackers, approval flows, portals, and dashboards your team needs without waiting for a custom internal-tools backlog."
      forWhom="Operations teams that run repeatable processes across people, data, approvals, and reporting."
      canBuild={[
        'Request intake and approval apps.',
        'Team dashboards for work-in-progress and exceptions.',
        'Client or vendor portals with forms and status tracking.',
      ]}
      capabilities={[
        'Built-in database for structured operational records.',
        'Authentication and project access controls.',
        'Agent-generated forms, tables, and dashboards.',
        'Publishing for internal or external users.',
      ]}
      workflow={[
        'Describe the current spreadsheet, email, or handoff process.',
        'Let the Agent generate the forms, data model, and dashboard.',
        'Test the flow with a small team.',
        'Refine fields, statuses, and permissions as the process evolves.',
      ]}
      benefits={[
        'Reduce manual status chasing and duplicate data entry.',
        'Ship small operational tools without a long engineering queue.',
        'Keep ownership close to the people who run the process every day.',
      ]}
    />
  );
}
