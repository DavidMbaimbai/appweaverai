import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { getMarketingNavUser } from '@/lib/auth/nav-user';

type RoleSection = {
  title: string;
  items: string[];
};

type RolePageProps = {
  title: string;
  description: string;
  forWhom: string;
  canBuild: string[];
  capabilities: string[];
  workflow: string[];
  benefits: string[];
  ctaLabel?: string;
  ctaHref?: string;
};

function SectionList({ title, items }: RoleSection) {
  return (
    <section className="rounded-[20px] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <h2 className="font-display text-xl tracking-[-0.02em] text-text-agent-heading">
        {title}
      </h2>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li
            key={item}
            className="flex gap-2.5 font-display text-sm leading-relaxed text-text-dim">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-appweaver-orange" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export async function RolePage({
  title,
  description,
  forWhom,
  canBuild,
  capabilities,
  workflow,
  benefits,
  ctaLabel = 'Start building for free',
  ctaHref = '/?auth=register',
}: RolePageProps) {
  const initialUser = await getMarketingNavUser();

  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[60vh] py-16 tablet-up:py-24">
        <Container className="flex flex-col items-center gap-6 text-center">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-appweaver-orange">
            For Work
          </p>
          <h1 className="font-display text-[40px] leading-none tracking-[-1.6px] text-text-agent-heading tablet-up:text-[56px]">
            {title}
          </h1>
          <p className="max-w-[680px] font-display text-lg leading-snug text-text-dim">
            {description}
          </p>
          <Button href={ctaHref} className="mt-2 h-[45px] px-6">
            {ctaLabel}
          </Button>
        </Container>

        <Container className="mt-16 grid grid-cols-1 gap-4 tablet-up:mt-20 tablet-up:grid-cols-2">
          <SectionList title="Who it is for" items={[forWhom]} />
          <SectionList title="What you can build" items={canBuild} />
          <SectionList title="Relevant capabilities" items={capabilities} />
          <SectionList title="Typical workflow" items={workflow} />
        </Container>

        <Container className="mt-4">
          <SectionList title="Benefits" items={benefits} />
        </Container>
      </main>
      <Footer />
    </>
  );
}
