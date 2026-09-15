import { RolePage } from '@/components/marketing/role-page';

export default function SmbRolePage() {
  return (
    <RolePage
      title="AppWeaver AI for Small Business Owners"
      description="Build the website, booking flow, customer portal, or internal tracker your business needs without hiring a developer first."
      forWhom="Small business owners who need useful software for customers or staff but do not want a long agency process."
      canBuild={[
        'Business websites and lead-capture pages.',
        'Booking, intake, or request forms.',
        'Customer portals and simple internal dashboards.',
      ]}
      capabilities={[
        'Plain-language prompting with no coding required.',
        'Built-in publishing and custom-domain support on paid plans.',
        'Simple account and project management.',
        'Editable copy and layouts after the first version is generated.',
      ]}
      workflow={[
        'Describe the business, the customer, and the action you want people to take.',
        'Review the generated pages and forms.',
        'Update copy, offers, and fields as your business changes.',
        'Publish when the flow is ready to share.',
      ]}
      benefits={[
        'Start with a free plan and upgrade when the project grows.',
        'Avoid waiting weeks for small updates.',
        'Own a working app that can change with the business.',
      ]}
    />
  );
}
