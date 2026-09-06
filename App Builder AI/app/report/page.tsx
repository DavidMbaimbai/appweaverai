import { LegalPage } from '@/components/marketing/legal-page';

export default function ReportAbusePage() {
  return (
    <LegalPage
      title="Report Abuse"
      lastUpdated="September 6, 2026"
      intro={[
        'AppWeaver AI relies on our community to help us identify content or projects that violate our Terms of Service. This page explains what to report, how we review reports, and how to reach us for urgent issues.',
      ]}
      sections={[
        {
          heading: 'What to Report',
          body: [
            'Spam, phishing, or malicious code hosted in a project.',
            'Harassment, hate speech, or content that targets an individual or group.',
            'Infringement of intellectual property rights, or impersonation of another person or business.',
          ],
        },
        {
          heading: 'How to Submit a Report',
          body: [
            'Send a report to abuse@appweaver.ai with a link to the project or account in question, a description of the issue, and any supporting evidence.',
          ],
        },
        {
          heading: 'How We Review Reports',
          body: [
            'Our team reviews every report we receive and takes action consistent with our Terms of Service and Acceptable Use policies, which may include removing content or suspending an account.',
            'We aim to acknowledge reports promptly, though investigation timelines vary depending on complexity.',
          ],
        },
        {
          heading: 'Security Vulnerabilities',
          body: [
            'If you have found a security vulnerability rather than a policy violation, please report it directly to security@appweaver.ai so our security team can respond quickly.',
          ],
        },
        {
          heading: 'Retaliation & False Reports',
          body: [
            'We prohibit retaliation against anyone who submits a good-faith report. Deliberately false reports may result in action against the reporting account.',
          ],
        },
      ]}
    />
  );
}
