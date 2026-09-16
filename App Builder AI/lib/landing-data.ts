import type {
  AgentFeature,
  ExamplePrompt,
  NavGroup,
  NavLink,
  PlatformFeature,
  PricingPlan,
  ProjectCategory,
  Testimonial,
} from "@/lib/types";

/**
 * Static content for the landing page.
 *
 * Separating data from components is a best practice:
 * - Designers/content folks can edit copy without touching JSX
 * - Components stay focused on layout and behavior
 * - The same data can power tests or CMS integration later
 */

export const topNavLinks: NavLink[] = [
  { label: "Security", href: "/security" },
  { label: "Pricing", href: "/pricing" },
];

export const navGroups: NavGroup[] = [
  {
    title: "Products",
    links: [
      { label: "Agent", href: "/agent" },
      { label: "Design", href: "/design" },
      { label: "Databases", href: "/databases" },
      { label: "Publish Apps", href: "/publish" },
      { label: "Integrations", href: "/integrations" },
      { label: "Mobile", href: "/mobile" },
    ],
  },
  {
    title: "For Work",
    links: [
      {
        label: "Pro",
        href: "/pro",
        description: "AppWeaver AI for serious builders",
      },
      {
        label: "Enterprise",
        href: "/enterprise",
        description: "AppWeaver AI with Enterprise-grade security & controls",
      },
    ],
    subsections: [
      {
        title: "Use Cases",
        links: [
          { label: "Business Apps", href: "/use-cases/business" },
          { label: "Mobile Apps", href: "/use-cases/mobile" },
          { label: "Rapid Prototyping", href: "/use-cases/prototyping" },
        ],
      },
      {
        title: "Roles",
        links: [
          { label: "Enterprise", href: "/roles/enterprise" },
          { label: "PM", href: "/roles/pm" },
          { label: "Designers", href: "/roles/designers" },
          { label: "Operations", href: "/roles/operations" },
          { label: "Software Developers", href: "/roles/developers" },
          { label: "SMB Owners", href: "/roles/smb" },
          { label: "Founders", href: "/roles/founders" },
        ],
      },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Partners", href: "/partners" },
      { label: "Community", href: "/community" },
      { label: "Expert Network", href: "/experts" },
      { label: "Customer Stories", href: "/stories" },
      { label: "Gallery", href: "/gallery" },
      { label: "Blog", href: "/blog" },
      { label: "News", href: "/news" },
      { label: "Vibecon", href: "/vibecon", accent: true },
    ],
  },
];

export const projectCategories: ProjectCategory[] = [
  { id: "website", label: "Website", icon: "website" },
  { id: "mobile", label: "Mobile", icon: "mobile" },
  { id: "design", label: "Design", icon: "design" },
  { id: "slides", label: "Slides", icon: "slides" },
  { id: "animation", label: "Animation", icon: "animation" },
  { id: "data", label: "Data Visualization", icon: "data" },
  { id: "game", label: "3D Game", icon: "game" },
  { id: "document", label: "Document", icon: "document" },
  { id: "spreadsheet", label: "Spreadsheet", icon: "spreadsheet" },
];

export const examplePromptSets: ExamplePrompt[][] = [
  [
    {
      label: "Beginner running tracker",
      text: "A fitness tracking app for beginner runners that logs workouts, tracks distance and time, and shows monthly progress",
    },
    {
      label: "Fitness app onboarding wireframe",
      text: "A wireframe for the onboarding flow of a personal fitness tracking app that introduces features like workout logging, goal setting, and progress tracking",
    },
    {
      label: "Checkout flow prototype",
      text: "A clickable checkout flow prototype for an e-commerce clothing store to test the purchase experience with users",
    },
  ],
  [
    {
      label: "B2B project management app",
      text: "A project management web app for a small B2B SaaS startup team to track tasks, assign owners, set deadlines, and view progress across projects",
    },
    {
      label: "Freelance client portal",
      text: "A client portal for a freelance design business where customers can submit requests, upload files, and track the status of their projects",
    },
    {
      label: "AI sales assistant",
      text: "An AI sales assistant web app for a small SaaS company that drafts and sends personalized outreach emails to potential customers",
    },
  ],
  [
    {
      label: "SaaS hero animation",
      text: "A simple looping hero animation for a SaaS website homepage that shows team members collaborating on shared tasks",
    },
    {
      label: "Startup pitch explainer",
      text: "An animated explainer video for a startup pitch illustrating the problem and the product solution",
    },
    {
      label: "SaaS KPI dashboard",
      text: "A SaaS KPI dashboard showing user growth, churn rate, and retention trends over time",
    },
  ],
];

export const heroTaglines = [
  "Turn ideas into apps in minutes — no coding needed",
  "You can always make changes later.",
  "Your first prompt is free. No credit consumption.",
];

export const AVATAR_BASE = "https://ui-avatars.com/api/?background=random&size=256&name=";

export const agentFeatures: AgentFeature[] = [
  {
    id: "canvas",
    eyebrow: "Visual editing",
    title: "Point, tweak, done",
    description:
      "Click any element in the live preview to nudge copy, spacing, or color — your changes land straight in the underlying code, no prompt required.",
    variant: "canvas",
  },
  {
    id: "parallel",
    eyebrow: "Concurrent workstreams",
    title: "Three jobs, one pass",
    description:
      "Wiring up auth, the database schema, and the UI don't have to happen one after another. The agent runs them side by side and reports back when everything's wired together.",
    variant: "parallel",
  },
  {
    id: "artifacts",
    eyebrow: "One project, every surface",
    title: "Web, mobile, docs — together",
    description:
      "Spin up a landing page, a companion mobile screen, and a pitch deck inside the same project, all pulling from one shared design system.",
    variant: "artifacts",
  },
  {
    id: "teams",
    eyebrow: "Built for teammates",
    title: "Everyone queues, the agent sorts it out",
    description:
      "Drop requests in whatever order works for your team — the agent figures out dependencies and runs them in the sequence that actually makes sense.",
    variant: "teams",
  },
];

export const platformFeatures: PlatformFeature[] = [
  {
    id: "agent",
    eyebrow: "Agent chat",
    title: "Describe it. Publish it.",
    description:
      "Describe and publish your project. The Agent writes production-ready code, evolves it, and stays out of your way.",
    variant: "agent",
  },
  {
    id: "infrastructure",
    eyebrow: "Full stack infrastructure",
    title: "Build & scale your apps easily.",
    description:
      "Built-in services with zero setup- Authentication, Database, Hosting, and Monitoring, enabling you to build fully scalable apps easily and securely from day one.",
    variant: "infrastructure",
  },
  {
    id: "integrations",
    eyebrow: "Integrations",
    title: "Connect to AI & services.",
    description:
      "Enhance your apps with AI and 100+ integrations. Connect to OpenAI, Stripe, Google Workspace, and more in minutes.",
    variant: "integrations",
  },
  {
    id: "enterprise",
    eyebrow: "Enterprise control",
    title: "Secure your apps as they scale.",
    description:
      "Security controls: SSO/SAML options, admin roles, audit logs, and privacy controls help teams govern apps as they grow.",
    variant: "enterprise",
  },
];

export const testimonials: Testimonial[] = [
  {
    id: "cloudforge",
    quote:
      "By integrating with our own data lake and analytics stack, we're combining AppWeaver AI's capabilities with trusted enterprise data and governance, helping teams move from idea to production faster and more securely than ever.",
    author: "Maria Chen",
    role: "CEO",
    company: "CloudForge Analytics",
    avatarUrl: `${AVATAR_BASE}Maria+Chen`,
  },
  {
    id: "homehive",
    quote:
      "Agent 4 unlocks true collaboration and real-time learning — now our teams can design and build with our closest partners live, turn instant feedback into measurable wins, and deliver outcomes that delight customers and partners.",
    author: "Daniel Osei",
    role: "Principal Program Manager",
    company: "HomeHive",
    avatarUrl: `${AVATAR_BASE}Daniel+Osei`,
  },
  {
    id: "paywise",
    quote:
      "AppWeaver AI Agent 4 is incredible. Its ability to take a one-shot prompt and flesh out the requirements before a full build is unmatched. It requires very little guidance to take a rough concept to a functional prototype.",
    author: "Sara Newton",
    role: "Principal Product Manager",
    company: "PayWise",
    avatarUrl: `${AVATAR_BASE}Sara+Newton`,
  },
  {
    id: "flowledger",
    quote:
      "The parallel task execution is a game-changer for us. We have multiple builders working on the same codebase every day, and the ability to submit tasks simultaneously with full visibility before anything merges is exactly how we've wanted to work.",
    author: "Jordan Blake",
    role: "Co-Founder & Chief AI Officer",
    company: "FlowLedger",
    avatarUrl: `${AVATAR_BASE}Jordan+Blake`,
  },
  {
    id: "helpdeskly",
    quote:
      "To deliver the world's best customer experience, our internal teams need to work without limits. AppWeaver AI gives our teams the 'superpowers' to prototype and scale internal solutions in hours rather than weeks.",
    author: "Amara Odhiambo",
    role: "SVP, Global People and Talent",
    company: "Helpdeskly",
    avatarUrl: `${AVATAR_BASE}Amara+Odhiambo`,
  },
  {
    id: "brightlab",
    quote:
      "Agent 4 is a game-changer. Multi-user vibe coding via the kanban is a significant milestone for enterprises. It's great for turning individual concepts into team realities and managing tasks through diverse role definitions.",
    author: "Kenji Watanabe",
    role: "Director",
    company: "BrightLab Digital",
    avatarUrl: `${AVATAR_BASE}Kenji+Watanabe`,
  },
];

export const pricingPlans: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    description: "Explore AppWeaver AI",
    monthlyPrice: 0,
    yearlyPrice: 0,
    ctaLabel: "Start for free",
    ctaHref: "/?auth=register",
    accent: "orange",
    featuresIntro: "Explore what's possible:",
    features: [
      "Limited daily AI credits",
      "Up to 3 active projects",
      "Built-in database",
      "Publish 1 live project",
      "Run one background task at a time",
    ],
  },
  {
    id: "builder",
    name: "Builder",
    description: "For individual builders",
    monthlyPrice: 12,
    yearlyPrice: 10,
    originalPrice: 12,
    ctaLabel: "Start Building",
    ctaHref: "/app/billing",
    accent: "orange",
    icon: "sparkle",
    badges: ["1,200 credits/mo"],
    featuresIntro: "Everything in Free plus:",
    features: [
      "1,200 AppWeaver credits a month",
      "Unlimited projects",
      "Up to 5 live deployments",
      "Custom domains",
      'Remove "Made with AppWeaver AI" badge',
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "For professional builders",
    monthlyPrice: 25,
    yearlyPrice: 20,
    originalPrice: 25,
    ctaLabel: "Go Pro",
    ctaHref: "/app/billing",
    accent: "blue",
    icon: "rocket",
    badges: ["4,000 credits/mo", "5 parallel agents"],
    featuresIntro: "Everything in Builder plus:",
    features: [
      "4,000 AppWeaver credits a month",
      "Unlimited live deployments",
      "Access to advanced AI models",
      "Up to 5 collaborators",
      "30-day version history",
    ],
  },
  {
    id: "business",
    name: "Business",
    description: "For teams and startups",
    monthlyPrice: 99,
    yearlyPrice: 89,
    originalPrice: 99,
    ctaLabel: "Start Business",
    ctaHref: "/app/billing",
    accent: "blue",
    badges: ["10,000 credits/mo", "Team workspace"],
    featuresIntro: "Everything in Pro plus:",
    features: [
      "10,000 AppWeaver credits a month",
      "Up to 10 parallel agents",
      "Up to 15 collaborators",
      "90-day version history",
      "Team management and RBAC",
    ],
  },
];

export const enterprisePlan = {
  name: "Enterprise",
  description: "Custom",
  ctaLabel: "Contact sales",
  ctaHref: "/contact-sales",
  featuresIntro: "Built for organizations requiring security, control and dedicated scale.",
  features: [
    "SSO / SAML",
    "Advanced RBAC",
    "Audit logs",
    "Dedicated / single-tenant environments",
    "Regional hosting",
    "Custom AI credit limits",
    "SLA and dedicated support",
  ],
};

/** Pro seat tiers for the pricing dropdown. */
export const proSeatTiers = [
  { seats: 100, monthly: 100, yearly: 90 },
  { seats: 300, monthly: 300, yearly: 278 },
  { seats: 500, monthly: 500, yearly: 463 },
  { seats: 1000, monthly: 1000, yearly: 900 },
  { seats: 2500, monthly: 2500, yearly: 2125 },
  { seats: 4000, monthly: 4000, yearly: 3200 },
];

export const footerColumns: NavGroup[] = [
  {
    title: "Handy Links",
    links: [
      { label: "Vibe Coding 101", href: "/vibe-coding" },
      { label: "How to guides", href: "/guides" },
      { label: "Import from GitHub", href: "/import" },
      { label: "Help", href: "/help" },
      { label: "Status", href: "/status" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", href: "/about" },
      { label: "Brand", href: "/brand" },
      { label: "Certifications", href: "/certifications" },
      { label: "Careers", href: "/careers" },
      { label: "Partnerships", href: "/partnerships" },
      { label: "Education", href: "/education" },
      { label: "Startups", href: "/startups" },
      { label: "Race to Revenue", href: "/race-to-revenue" },
      { label: "Additional resources", href: "/resources" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of service", href: "/terms" },
      { label: "Commercial agreement", href: "/commercial" },
      { label: "Privacy", href: "/privacy" },
      { label: "Subprocessors", href: "/subprocessors" },
      { label: "DPA", href: "/dpa" },
      { label: "Report abuse", href: "/report" },
    ],
  },
  {
    title: "Connect",
    links: [
      { label: "X / Twitter", href: "https://twitter.com/appweaverai" },
      { label: "TikTok", href: "https://tiktok.com/@appweaverai" },
      { label: "Facebook", href: "https://facebook.com/appweaverai" },
      { label: "Instagram", href: "https://instagram.com/appweaverai" },
      { label: "LinkedIn", href: "https://linkedin.com/company/appweaverai" },
    ],
  },
];

