import { RequestForm } from '@/components/privacy/request-form';
import { verifyRequest } from '@/lib/privacy/requests';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Privacy request', robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const verified = token && process.env.DATABASE_URL ? await verifyRequest(token) : null;

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-semibold text-app-text">Privacy request</h1>
      {verified ? (
        verified.ok ? (
          <p className="text-sm text-app-text">
            Thank you, your request is confirmed. We will respond by {verified.dueAt.toLocaleDateString('en-GB')} (within 30 days).
          </p>
        ) : (
          <p className="text-sm text-red-400">{verified.error}</p>
        )
      ) : (
        <>
          <p className="mb-6 text-sm text-app-text-muted">
            Ask to access, correct or erase personal data we hold about you (GDPR / POPIA). We verify your email address first, then respond within 30 days.
          </p>
          <RequestForm />
        </>
      )}
    </main>
  );
}
