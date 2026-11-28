import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import { RootProviders } from '@/components/root-providers';
import { AuthSessionProvider } from '@/components/auth/session-provider';
import { AuthModalProvider } from '@/components/auth/auth-modal-provider';
import { AuthUrlSync } from '@/components/auth/auth-url-sync';
import { CookieBanner } from '@/components/cookie-banner';
import { GrowthTracker } from '@/components/growth-bi/growth-tracker';
import { getEnabledOAuthProviders } from '@/lib/auth/oauth-config';

export const metadata: Metadata = {
  title: 'AppWeaver AI | From imagination to implementation',
  description:
    'Design, build, launch, market and grow digital products from one AI-powered workspace. Turn your idea into a working product with AppWeaver AI.',
  openGraph: {
    title: 'AppWeaver AI | From imagination to implementation',
    description:
      'Design, build, launch, market and grow digital products from one AI-powered workspace.',
    type: 'website',
  },
  icons: {
    icon: [
      { url: '/icon.svg?v=2', type: 'image/svg+xml' },
      { url: '/icon.png?v=2', type: 'image/png' },
    ],
    shortcut: '/favicon.ico?v=2',
    apple: '/apple-icon.png?v=2',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const enabledOAuthProviders = getEnabledOAuthProviders(process.env);

  return (
    <html lang="en" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full flex flex-col">
        <AuthSessionProvider>
          <AuthModalProvider enabledOAuthProviders={enabledOAuthProviders}>
            <RootProviders>
              <AuthUrlSync />
              {children}
              <CookieBanner />
              <GrowthTracker />            </RootProviders>
          </AuthModalProvider>
        </AuthSessionProvider>
      </body>
      <Script
        defer
        src="https://www.ship-or-die.com/hackathon/verify.js"
        data-site="b2696ac66de69d6355131287c1b6efc47d1ee31e"
        strategy="afterInteractive"
      />
    </html>
  );
}

