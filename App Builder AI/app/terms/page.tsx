import { LegalPage } from '@/components/marketing/legal-page';

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="September 6, 2026"
      intro={[
        "This agreement governs your access to and use of AppWeaver AI's services and is between you and AppWeaver AI, Inc. (\"AppWeaver AI,\" \"we,\" \"us,\" \"our\") and its affiliates. We provide a platform to describe, build, and publish software through our websites and apps (the \"Service\"). By using the Service you agree to these Terms of Service. If you do not agree, you must not use the Service.",
        "If you are on a Pro or Enterprise plan, our Commercial Agreement also applies to your use of the Service.",
      ]}
      sections={[
        {
          heading: 'Accounts & Registration',
          body: [
            'You must provide accurate information when creating an account and keep your login credentials secure. You are responsible for all activity that happens under your account.',
            'You must be at least 13 years old to use the Service. If you are under 18, you need permission from a parent or guardian.',
          ],
        },
        {
          heading: 'Acceptable Use',
          body: [
            'You may not use the Service to distribute malware, harass others, infringe intellectual property, or otherwise violate applicable law.',
            'We may set reasonable usage limits (such as credits, storage, or collaborator counts) depending on your plan, and may suspend accounts that abuse or attempt to circumvent those limits.',
          ],
        },
        {
          heading: 'Your Content',
          body: [
            'You retain ownership of the projects, code, and content you create using the Service. You grant us a limited license to host, store, and display that content solely to operate and improve the Service.',
            'You are responsible for ensuring you have the rights to any content, files, or data you upload or generate through the Service.',
          ],
        },
        {
          heading: 'Payment & Billing',
          body: [
            'Paid plans are billed in advance on a monthly or annual basis. Credits and usage-based features are described on our Pricing page and may change with notice.',
            'You can cancel a paid plan at any time; cancellation takes effect at the end of the current billing period unless otherwise stated.',
          ],
        },
        {
          heading: 'Termination',
          body: [
            'You may stop using the Service and delete your account at any time. We may suspend or terminate accounts that violate these Terms or applicable law.',
            'Upon termination, your right to use the Service ends, though certain provisions of these Terms (such as ownership, liability, and dispute resolution) will survive.',
          ],
        },
        {
          heading: 'Disclaimers & Limitation of Liability',
          body: [
            'The Service is provided "as is" without warranties of any kind. To the maximum extent permitted by law, AppWeaver AI is not liable for indirect, incidental, or consequential damages arising from your use of the Service.',
          ],
        },
        {
          heading: 'Governing Law',
          body: [
            'These Terms are governed by the laws of the jurisdiction in which AppWeaver AI is incorporated, without regard to conflict-of-law principles.',
          ],
        },
        {
          heading: 'Changes to These Terms',
          body: [
            'We may update these Terms from time to time. If we make material changes, we will provide notice through the Service or by email before the changes take effect.',
          ],
        },
        {
          heading: 'Contact',
          body: [
            'Questions about these Terms can be sent to legal@appweaver.ai.',
          ],
        },
      ]}
    />
  );
}

