import { LegalPage } from '@/components/marketing/legal-page';

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated="September 6, 2026"
      intro={[
        "This Privacy Policy explains how AppWeaver AI, Inc. (\"AppWeaver AI,\" \"we,\" \"us\") collects, uses, and protects information when you use our websites, apps, and platform (the \"Service\"). It applies to visitors, account holders, and anyone whose data passes through projects built on the Service.",
        "By using the Service, you agree to the collection and use of information as described here. If you do not agree, please do not use the Service.",
      ]}
      sections={[
        {
          heading: 'Information We Collect',
          body: [
            'Account information such as your name, email address, and authentication details when you sign up or log in.',
            'Usage information such as pages visited, features used, and interactions with the Agent, collected to improve reliability and performance.',
            'Content you create, including prompts, code, and project files, which is stored so you can access and edit your work.',
          ],
        },
        {
          heading: 'How We Use Information',
          body: [
            'To operate, maintain, and improve the Service, including training internal quality checks on Agent responses.',
            'To communicate with you about your account, security notices, and product updates.',
            'To detect, prevent, and respond to fraud, abuse, or security incidents.',
          ],
        },
        {
          heading: 'How We Share Information',
          body: [
            'We share data with service providers who help us run the Service, such as hosting, AI model, and payment providers, under contracts that limit their use of your data.',
            'We may disclose information if required by law or to protect the rights, safety, and property of AppWeaver AI and our users.',
            'We do not sell your personal information to third parties.',
          ],
        },
        {
          heading: 'Data Retention',
          body: [
            'We retain account and project data for as long as your account is active, or as needed to provide the Service. You can request deletion of your account and associated data at any time.',
          ],
        },
        {
          heading: 'Your Rights & Choices',
          body: [
            'Depending on where you live, you may have rights to access, correct, export, or delete your personal data. You can exercise these rights from your account settings or by contacting us.',
          ],
        },
        {
          heading: 'Security',
          body: [
            'We use industry-standard technical and organizational measures to protect your data, including encryption in transit and access controls. No system is completely secure, and we encourage you to use strong, unique passwords.',
          ],
        },
        {
          heading: 'Changes to This Policy',
          body: [
            'We may update this Privacy Policy from time to time. Material changes will be announced through the Service or by email before they take effect.',
          ],
        },
        {
          heading: 'Contact',
          body: [
            'Questions about this policy or your data can be sent to privacy@appweaver.ai.',
          ],
        },
      ]}
    />
  );
}
