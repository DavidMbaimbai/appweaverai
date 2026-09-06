import { ProductPage } from '@/components/marketing/product-page';

export default function SecurityPage() {
  return (
    <ProductPage
      eyebrow="Security"
      title="Secure by default, from prototype to production"
      description="Every app on AppWeaver AI runs on isolated infrastructure with automated scanning, protected secrets, and round-the-clock monitoring — so security is built in, not bolted on."
      highlights={[
        {
          title: 'Per-customer isolation',
          description:
            'Each account runs in its own isolated cloud environment, so your data is separated at the infrastructure level, not just behind logical database rules.',
        },
        {
          title: 'Hardened project sandboxes',
          description:
            'Every project runs in its own locked-down container with restricted system calls, keeping workloads separated from one another.',
        },
        {
          title: 'Secrets never touch your code',
          description:
            'API keys and credentials are injected at runtime through a secure proxy. They never appear in your source, your editor, or the Agent\u2019s context.',
        },
        {
          title: 'Automated pre-publish scanning',
          description:
            'Before a project can be published, it is automatically scanned for common vulnerabilities, exposed secrets, and risky dependencies.',
        },
        {
          title: 'Continuous monitoring',
          description:
            'Automated systems watch for anomalous activity around the clock and alert our security team the moment something looks wrong.',
        },
        {
          title: 'Enterprise access controls',
          description:
            'Single sign-on, SCIM provisioning, and role-based access control let organizations manage who can view, edit, or publish projects.',
        },
        {
          title: 'Compliance program',
          description:
            'We maintain a SOC 2 Type II report and align our practices with GDPR, with additional certifications on our roadmap.',
        },
        {
          title: 'Responsible disclosure',
          description:
            'Security researchers can report findings through our Report Abuse page, and we work with outside partners to test our defenses continuously.',
        },
      ]}
      faqs={[
        {
          question: 'Where is my data stored?',
          answer:
            'Your projects and account data are stored in isolated cloud infrastructure, with each customer logically and physically separated from others.',
        },
        {
          question: 'How are projects isolated from each other?',
          answer:
            'Every project runs in its own sandboxed container with restricted permissions, so activity in one project cannot affect another.',
        },
        {
          question: 'How does AppWeaver AI protect API keys and secrets?',
          answer:
            'Secrets are stored separately from your code and injected only at runtime through a secure proxy, so they are never exposed in the editor or to the Agent.',
        },
        {
          question: 'Does AppWeaver AI scan projects before they go live?',
          answer:
            'Yes. Every publish goes through automated checks for known vulnerabilities, exposed credentials, and risky dependencies before it becomes public.',
        },
        {
          question: 'Is AppWeaver AI compliant with industry standards?',
          answer:
            'We hold a SOC 2 Type II report and design our data handling practices to align with GDPR requirements, with further certifications planned.',
        },
        {
          question: 'What happens if a security issue is found?',
          answer:
            'We investigate every report, identify the root cause, and ship a hardening fix. We also work with external security partners to continuously test the platform.',
        },
      ]}
      ctaLabel="Contact security team"
      ctaHref="mailto:security@appweaver.ai"
    />
  );
}

