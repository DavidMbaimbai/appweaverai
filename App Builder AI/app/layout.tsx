import type { Metadata } from 'next';
import './globals.css';
import { RootProviders } from '@/components/root-providers';
import { AuthSessionProvider } from '@/components/auth/session-provider';
import { AuthModalProvider } from '@/components/auth/auth-modal-provider';
import { AuthUrlSync } from '@/components/auth/auth-url-sync';

export const metadata: Metadata = {
  title: 'AppWeaver AI - Build apps and sites with AI',
  description:
    'turn ideas into apps in minutes. AppWeaver AI agent writes production-ready code, evolves it, and stays out of your way.',
  openGraph: {
    title: 'AppWeaver AI - Build apps and sites with AI',
    description: 'Turn ideas into apps in minutes - no coding needed.',
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
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <AuthSessionProvider>
          <AuthModalProvider>
            <RootProviders>
              <AuthUrlSync />
              {children}
            </RootProviders>
          </AuthModalProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}

