import Image from 'next/image';
import Link from 'next/link';

import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { getMarketingNavUser } from '@/lib/auth/nav-user';

const founders = [
  {
    name: 'David Mbaimbai',
    role: 'Co-Founder',
    photo: '/images/team/david-mbaimbai.jpeg',
  },
  {
    name: 'Arnold Tyvern Madamombe',
    role: 'Co-Founder',
    photo: '/images/team/arnold-tyvern-madamombe.jpeg',
  },
];

export default async function AboutPage() {
  const initialUser = await getMarketingNavUser();

  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[60vh] py-16 tablet-up:py-24">
        <Container className="flex flex-col items-center gap-6 text-center">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-appweaver-orange">
            Company
          </p>
          <h1 className="font-display text-[40px] leading-none tracking-[-1.6px] text-text-agent-heading tablet-up:text-[56px]">
            From the Classroom to Building the Future
          </h1>
          <p className="max-w-[680px] font-display text-lg leading-snug text-text-dim">
            AppWeaver AI was founded by David Mbaimbai and Arnold Tyvern
            Madamombe, two former mathematics teachers who turned their
            passion for problem-solving into careers as senior software
            developers.
          </p>
        </Container>

        <Container className="mt-16 max-w-[760px] tablet-up:mt-20">
          <div className="space-y-6 font-display text-lg leading-relaxed text-text-dim">
            <p>
              Their journey from teaching mathematics to building complex
              software systems shaped a simple belief:{' '}
              <span className="font-medium text-text-agent-heading">
                technology should make solving problems easier, not harder.
              </span>
            </p>
            <p>
              After years of working in software engineering and seeing how
              much time, technical knowledge, and effort it takes to turn an
              idea into a working application, David and Arnold set out to
              build something different.
            </p>
            <p className="font-medium text-text-agent-heading">
              AppWeaver AI was born from that vision — to make software
              creation accessible to everyone.
            </p>
            <p>
              By combining their mathematical foundations, teaching
              experience, software engineering expertise, and artificial
              intelligence, they are building a platform where entrepreneurs,
              businesses, creators, and developers can transform ideas into
              real applications through natural language.
            </p>
          </div>
        </Container>

        <Container className="mt-16 max-w-[760px] tablet-up:mt-20">
          <h2 className="font-display text-2xl tracking-[-0.02em] text-text-agent-heading">
            Our Mission
          </h2>
          <p className="mt-4 font-display text-xl leading-snug text-text-agent-heading">
            Turn ideas into software, without letting technical complexity
            stand in the way.
          </p>
          <p className="mt-4 font-display text-lg leading-relaxed text-text-dim">
            From teaching people how to solve equations to building
            technology that helps people solve real-world problems, the
            mission remains the same:{' '}
            <span className="font-medium text-text-agent-heading">
              Empower people to create.
            </span>
          </p>
        </Container>

        <Container className="mt-16 tablet-up:mt-20">
          <h2 className="text-center font-display text-2xl tracking-[-0.02em] text-text-agent-heading">
            Meet the founders
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-6 tablet-up:grid-cols-2">
            {founders.map((founder) => (
              <div
                key={founder.name}
                className="flex flex-col items-center gap-4 rounded-[20px] bg-white p-8 text-center shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                <div className="relative h-28 w-28 overflow-hidden rounded-full bg-surface-dim">
                  <Image
                    src={founder.photo}
                    alt={founder.name}
                    fill
                    sizes="112px"
                    className="object-cover"
                  />
                </div>
                <div>
                  <p className="font-display text-xl tracking-[-0.02em] text-text-agent-heading">
                    {founder.name}
                  </p>
                  <p className="mt-1 text-sm text-text-dim">{founder.role}</p>
                </div>
              </div>
            ))}
          </div>
        </Container>

        <Container className="mt-16 flex justify-center tablet-up:mt-20">
          <Button href="/?autostart=1" className="h-[45px] px-6">
            Start building for free
          </Button>
        </Container>

        <Container className="mt-12 flex justify-center">
          <Link
            href="/"
            className="text-sm text-text-agent-heading underline underline-offset-2 hover:text-text-primary">
            Back to home
          </Link>
        </Container>
      </main>
      <Footer />
    </>
  );
}
