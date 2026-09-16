import { Container } from '@/components/ui/container';
import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { getMarketingNavUser } from '@/lib/auth/nav-user';
import { DesignHero } from '@/components/marketing/design-hero';

const highlights = [
  {
    title: 'Live preview while it builds',
    description:
      'A running preview of your app sits right next to the chat, refreshing automatically as the agent writes each file.',
  },
  {
    title: 'Consistent, polished UI',
    description:
      'Generated apps share a cohesive set of components and styling, so pages look intentional from the first version.',
  },
  {
    title: 'Iterate with plain language',
    description:
      'Ask for layout, color, or copy changes in chat and the agent updates the code and preview together — no separate design tool required.',
  },
  {
    title: 'Start from a prompt or a reference',
    description:
      'Describe an idea, paste in a URL or screenshot to recreate, or pick a design system to kick off a first draft in minutes.',
  },
];

export default async function DesignPage() {
  const initialUser = await getMarketingNavUser();

  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[60vh] py-16 tablet-up:py-24">
        <DesignHero />

        <Container className="mt-16 grid grid-cols-1 gap-4 tablet-up:mt-20 tablet-up:grid-cols-2">
          {highlights.map((highlight) => (
            <div
              key={highlight.title}
              className="rounded-[20px] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
              <p className="font-display text-xl tracking-[-0.02em] text-text-agent-heading">
                {highlight.title}
              </p>
              <p className="mt-2 font-display text-base leading-snug text-text-dim">
                {highlight.description}
              </p>
            </div>
          ))}
        </Container>
      </main>
      <Footer />
    </>
  );
}
