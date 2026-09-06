import { LegalPage } from '@/components/marketing/legal-page';

export default function DpaPage() {
  return (
    <LegalPage
      title="Data Processing Agreement"
      lastUpdated="September 6, 2026"
      intro={[
        'This Data Processing Agreement ("DPA") describes how AppWeaver AI processes personal data on behalf of customers when acting as a data processor, in line with applicable data protection laws such as the GDPR.',
      ]}
      sections={[
        {
          heading: 'Scope of Processing',
          body: [
            'This DPA applies to personal data that customers or their end users submit to the Service, including account details and content stored within projects.',
          ],
        },
        {
          heading: 'Roles of the Parties',
          body: [
            'The customer acts as the data controller for personal data submitted to the Service. AppWeaver AI acts as the data processor and processes that data only on documented instructions from the customer.',
          ],
        },
        {
          heading: 'Security Measures',
          body: [
            'We maintain technical and organizational measures appropriate to the risk, including encryption in transit, access controls, and regular review of our security practices.',
          ],
        },
        {
          heading: 'Sub-processing',
          body: [
            'We may engage subprocessors to assist in providing the Service, as listed on our Subprocessors page. Subprocessors are bound by data protection obligations no less protective than this DPA.',
          ],
        },
        {
          heading: 'Data Subject Requests',
          body: [
            'Where we receive a request from a data subject relating to data we process on a customer\u2019s behalf, we will promptly notify the customer and provide reasonable assistance in responding.',
          ],
        },
        {
          heading: 'International Transfers',
          body: [
            'Where personal data is transferred internationally, we rely on appropriate safeguards such as standard contractual clauses.',
          ],
        },
        {
          heading: 'Requesting a Signed Copy',
          body: [
            'Enterprise customers can request a signed copy of this DPA, including any applicable annexes, by contacting our sales or legal team.',
          ],
        },
      ]}
    />
  );
}
