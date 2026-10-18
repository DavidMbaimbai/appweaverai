import { LegalPage } from '@/components/marketing/legal-page';

export const metadata = { title: 'Cookie Policy | AppWeaver AI' };

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      lastUpdated="October 18, 2026"
      intro={[
        'This Cookie Policy explains how AppWeaver AI uses cookies and similar technologies, and how you can control them.',
      ]}
      sections={[
        {
          heading: 'Strictly Necessary Cookies',
          body: [
            'These keep you signed in and protect your account (session and security cookies). They are HttpOnly, SameSite and, in production, Secure. The Service cannot work without them, so they are always on.',
            'We also store your cookie choice (aw_cookie_consent) for one year so we do not ask you again.',
          ],
        },
        {
          heading: 'Optional Cookies',
          body: [
            'Analytics and preference cookies help us understand usage and improve the Service. They are only set if you choose "Accept all". Choosing "Essential only" keeps them off.',
          ],
        },
        {
          heading: 'Managing Your Choice',
          body: [
            'You can change your choice at any time by clearing the aw_cookie_consent cookie in your browser settings, after which the banner appears again. You can also block or delete cookies in your browser; some features may stop working.',
          ],
        },
        {
          heading: 'Contact',
          body: ['Questions about cookies can be sent to privacy@appweaver.ai.'],
        },
      ]}
    />
  );
}
