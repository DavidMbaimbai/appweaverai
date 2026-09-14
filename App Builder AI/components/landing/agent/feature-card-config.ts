import type { AgentFeature } from "@/lib/types";

type FeatureVariantConfig = {
  bg: string;
  text: string;
  eyebrowClass: string;
  descriptionClass: string;
  illustration: string;
  illustrationWidth: number;
  illustrationHeight: number;
  /** How the illustration should sit inside its contained preview window. */
  illustrationFit: "contain" | "cover";
  illustrationClassName?: string;
};

/**
 * Every card shares one shape: a rounded rectangle with a contained preview
 * window on top and text below. No pill/blob shapes and no bleeding,
 * oversized illustrations — each variant only swaps colors and artwork.
 */
export const featureVariantConfig: Record<
  AgentFeature["variant"],
  FeatureVariantConfig
> = {
  canvas: {
    bg: "bg-feature-peach",
    text: "text-feature-charcoal",
    eyebrowClass: "text-feature-charcoal/60",
    descriptionClass: "text-feature-charcoal/70",
    illustration: "/illustrations/design-canvas.svg",
    illustrationWidth: 482,
    illustrationHeight: 686,
    illustrationFit: "cover",
    illustrationClassName: "object-top",
  },
  parallel: {
    bg: "bg-feature-stone",
    text: "text-feature-charcoal",
    eyebrowClass: "text-feature-charcoal/60",
    descriptionClass: "text-feature-charcoal/70",
    illustration: "/illustrations/parallel-agents.svg",
    illustrationWidth: 280,
    illustrationHeight: 261,
    illustrationFit: "contain",
  },
  artifacts: {
    bg: "bg-feature-charcoal",
    text: "text-white",
    eyebrowClass: "text-white/60",
    descriptionClass: "text-white/70",
    illustration: "/illustrations/multiple-artifacts.svg",
    illustrationWidth: 1085,
    illustrationHeight: 149,
    illustrationFit: "contain",
  },
  teams: {
    bg: "bg-feature-coral",
    text: "text-feature-charcoal",
    eyebrowClass: "text-feature-charcoal/60",
    descriptionClass: "text-feature-charcoal/75",
    illustration: "/illustrations/teams.svg",
    illustrationWidth: 508,
    illustrationHeight: 375,
    illustrationFit: "contain",
  },
};
