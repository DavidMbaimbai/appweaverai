import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';

export function CtaSection() {
  return (
    <section className="py-[120px]">
      <Container className="flex flex-col items-center gap-10 text-center">
        <h2 className="font-display text-[42px] font-normal leading-[42px] tracking-[-1.68px] text-text-cta-heading">
          Ready to bring your idea to life?
        </h2>
        <Button
          href="/?auth=register"
          size="lg"
          className="h-20 w-full max-w-cta-button font-display text-2xl font-normal">
          Start building for free
        </Button>
      </Container>
    </section>
  );
}
