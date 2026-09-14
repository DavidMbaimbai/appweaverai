import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { agentFeatures } from '@/lib/landing-data';
import Link from 'next/link';
import { FeatureCard } from './feature-card';

export function AgentSection() {
  const [canvas, parallel, artifacts, teams] = agentFeatures;

  return (
    <section className="py-12 desktop:py-20">
      <Container className="below-desktop:!px-4">
        <div className="text-center mobile:flex mobile:flex-col mobile:items-center mobile:gap-4">
          <p className="font-display text-sm font-medium uppercase tracking-[0.2em] text-appweaver-orange">
            The Agent
          </p>
          <h1 className="mt-3 font-display text-[40px] font-normal leading-[40px] tracking-[-2px] text-text-agent-heading desktop:text-[56px] desktop:leading-[1.05] desktop:tracking-[-2.8px]">
            Your build partner, start to launch
          </h1>
          <p className="font-display text-lg leading-snug tracking-[-0.02em] text-text-dim mobile:mt-0 desktop:mt-4 desktop:text-xl">
            Four ways the AppWeaver AI agent keeps a project moving without you
            juggling ten tools to do it.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-5 tablet-up:grid-cols-2 desktop:mt-12 desktop:gap-6">
          <FeatureCard feature={canvas} />
          <FeatureCard feature={parallel} />
          <FeatureCard feature={artifacts} />
          <FeatureCard feature={teams} />
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-8">
          <Button
            href="/agent"
            variant="outline"
            className="h-[45px] border-[1.5px] px-6">
            See the Agent in depth
          </Button>
          <Link
            href="/docs"
            className="text-sm text-text-agent-heading underline underline-offset-2 hover:text-text-primary">
            Read the documentation
          </Link>
        </div>
      </Container>
    </section>
  );
}

