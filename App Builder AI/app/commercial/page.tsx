import { LegalPage } from '@/components/marketing/legal-page';

export default function CommercialAgreementPage() {
  return (
    <LegalPage
      title="Commercial Agreement"
      lastUpdated="September 6, 2026"
      intro={[
        'This Commercial Agreement supplements our Terms of Service and applies to customers on paid, Pro, Teams, or Enterprise plans. It sets out the service levels, data handling, and support commitments that come with a paid subscription.',
      ]}
      sections={[
        {
          heading: 'Order of Precedence',
          body: [
            'If there is a conflict between this Agreement and our general Terms of Service, this Agreement controls for matters specific to paid plans.',
          ],
        },
        {
          heading: 'Service Levels',
          body: [
            'We target a monthly uptime of 99.9% for core Service infrastructure, excluding scheduled maintenance that we announce in advance.',
            'Enterprise customers may negotiate custom service level commitments as part of a signed order form.',
          ],
        },
        {
          heading: 'Data Handling',
          body: [
            'Customer data submitted through paid plans is processed only to provide the Service and is not used to train models for other customers without explicit consent.',
            'Data residency and retention options may vary by plan; Enterprise customers can request additional controls.',
          ],
        },
        {
          heading: 'Support Commitments',
          body: [
            'Paid plans include priority email support with response times based on plan tier. Enterprise plans include a named contact and defined escalation paths for critical issues.',
          ],
        },
        {
          heading: 'Fees & Renewal',
          body: [
            'Fees are set out in your order form or plan selection and are billed in advance. Plans renew automatically unless cancelled before the renewal date.',
          ],
        },
        {
          heading: 'Custom Agreements',
          body: [
            'Enterprise customers with specific procurement, security, or compliance requirements can request a tailored commercial agreement through our sales team.',
          ],
        },
      ]}
    />
  );
}
