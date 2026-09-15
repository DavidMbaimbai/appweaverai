import { RolePage } from '@/components/marketing/role-page';

export default function EnterpriseRolePage() {
  return (
    <RolePage
      title="AppWeaver AI for Enterprise"
      description="Give teams a governed way to turn ideas into internal tools and customer-facing apps without bypassing visibility and administrative control."
      forWhom="Enterprise teams that need faster delivery while maintaining admin oversight, access control, and support paths."
      canBuild={[
        'Departmental internal tools and dashboards.',
        'Customer portals and approval workflows.',
        'Prototypes that graduate into governed production apps.',
      ]}
      capabilities={[
        'Admin roles and permissioned console workflows.',
        'Audit logs and security-event tracking in the admin console.',
        'Contact-sales path for SSO/SAML and enterprise deployment discussions.',
        'Team billing, subscriptions, and project oversight.',
      ]}
      workflow={[
        'Start with a constrained business workflow or prototype.',
        'Review generated functionality with security and operations stakeholders.',
        'Publish under the right access model.',
        'Use admin visibility and support to scale adoption across teams.',
      ]}
      benefits={[
        'Reduce time from request to working software.',
        'Keep governance visible as more teams build.',
        'Support both internal tools and customer-facing app experiments.',
      ]}
      ctaLabel="Contact sales"
      ctaHref="/contact-sales"
    />
  );
}
