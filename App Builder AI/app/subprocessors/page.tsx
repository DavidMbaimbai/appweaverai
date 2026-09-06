import { LegalPage } from '@/components/marketing/legal-page';

export default function SubprocessorsPage() {
  return (
    <LegalPage
      title="Subprocessors"
      lastUpdated="September 6, 2026"
      intro={[
        'AppWeaver AI uses a limited number of third-party subprocessors to help deliver hosting, AI model access, payment processing, and other core parts of the Service. This page lists the categories of subprocessors we rely on and how we handle changes to this list.',
      ]}
      sections={[
        {
          heading: 'Infrastructure & Hosting Providers',
          body: [
            'We use cloud infrastructure and database providers to host application data, run compute workloads, and store project files securely.',
          ],
        },
        {
          heading: 'AI Model Providers',
          body: [
            'The Agent is powered by underlying language model providers. Prompts and generated content may be transmitted to these providers solely to produce a response, subject to their data handling terms.',
          ],
        },
        {
          heading: 'Payment Processing',
          body: [
            'Subscription billing and payment processing are handled by a PCI-compliant payment processor. We do not store full card numbers on our own systems.',
          ],
        },
        {
          heading: 'Analytics & Communications',
          body: [
            'We use analytics tools to understand product usage in aggregate, and email delivery providers to send account and billing notifications.',
          ],
        },
        {
          heading: 'Changes to This List',
          body: [
            'We periodically review and may add or replace subprocessors. Where required by a signed Data Processing Agreement, we will notify affected customers in advance of a change.',
          ],
        },
      ]}
    />
  );
}
