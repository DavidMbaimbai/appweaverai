import { LogoCloud } from "./logo-cloud";
import { HeroSection } from "./section";

export function AboveTheFold() {
  return (
    <section className="flex min-h-[calc(100vh-67px)] flex-col desktop:min-h-[calc(100vh-81px)]">
      <div className="flex flex-1 flex-col items-center justify-center desktop:flex-none desktop:items-stretch desktop:justify-start desktop:pt-9">
        <HeroSection />
      </div>
      <div className="desktop:mt-auto">
        <LogoCloud />
      </div>
    </section>
  );
}