/**
 * Compact generator for one-page starter templates used by
 * prisma/seed-website-templates.ts. Every generated page has a title, h1,
 * working in-page navigation, and a contact form wired to the form-submit shim.
 */

type TemplateKind = 'FULL_TEMPLATE' | 'SECTION';
type TemplateMarket =
  | 'FREELANCER'
  | 'SMALL_BUSINESS'
  | 'AGENCY'
  | 'SAAS'
  | 'GENERAL';

export type GeneratedTemplate = {
  slug: string;
  name: string;
  description: string;
  kind: TemplateKind;
  market: TemplateMarket;
  sortOrder: number;
  files: { path: string; content: string }[];
};

type Card = { title: string; text: string };

type SiteConfig = {
  slug: string;
  name: string;
  description: string;
  market: TemplateMarket;
  sortOrder: number;
  brand: string;
  pageTitle: string;
  headline: string;
  subhead: string;
  cta: string;
  accent: string;
  background?: string;
  text?: string;
  surface?: string;
  border?: string;
  muted?: string;
  sections: { id: string; title: string; intro?: string; cards: Card[] }[];
  testimonials: { quote: string; by: string }[];
  contactTitle: string;
  contactNote: string;
  submitLabel: string;
  messagePlaceholder: string;
};

function esc(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildSite(
  config: SiteConfig,
  baseReset: string,
  navJs: string,
): GeneratedTemplate {
  const navItems = [
    ...config.sections.map((s) => ({ id: s.id, label: s.title })),
    { id: 'reviews', label: 'Reviews' },
    { id: 'contact', label: 'Contact' },
  ];

  const sectionsHtml = config.sections
    .map(
      (s) => `  <section id="${s.id}" class="container">
    <h2>${esc(s.title)}</h2>${s.intro ? `\n    <p class="muted" style="max-width:640px;margin-bottom:20px">${esc(s.intro)}</p>` : ''}
    <div class="grid grid-3">
${s.cards
  .map(
    (c) => `      <article class="card">
        <h3>${esc(c.title)}</h3>
        <p class="muted" style="margin-top:8px">${esc(c.text)}</p>
      </article>`,
  )
  .join('\n')}
    </div>
  </section>`,
    )
    .join('\n\n');

  const reviewsHtml = config.testimonials
    .map(
      (t) => `      <div class="card">
        <p>&ldquo;${esc(t.quote)}&rdquo;</p>
        <p class="muted" style="margin-top:12px">— ${esc(t.by)}</p>
      </div>`,
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(config.pageTitle)}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="container">
    <nav class="site-nav">
      <span class="logo">${esc(config.brand)}</span>
      <ul>
${navItems.map((n) => `        <li><a href="#${n.id}">${esc(n.label)}</a></li>`).join('\n')}
      </ul>
    </nav>
  </header>

  <section class="hero container">
    <h1>${esc(config.headline)}</h1>
    <p class="muted" style="margin-top:16px;max-width:560px">${esc(config.subhead)}</p>
    <div style="margin-top:28px;display:flex;gap:16px">
      <a class="btn btn-primary" href="#contact">${esc(config.cta)}</a>
      <a class="btn btn-secondary" href="#${config.sections[0].id}">${esc(config.sections[0].title)}</a>
    </div>
  </section>

${sectionsHtml}

  <section id="reviews" class="container">
    <h2>What people say</h2>
    <div class="grid grid-3">
${reviewsHtml}
    </div>
  </section>

  <section id="contact" class="container">
    <h2>${esc(config.contactTitle)}</h2>
    <p class="muted" style="margin-bottom:20px">${esc(config.contactNote)}</p>
    <form class="contact-form" data-aw-form="contact">
      <input type="text" name="name" placeholder="Your name" required />
      <input type="email" name="email" placeholder="Your email" required />
      <textarea rows="4" name="message" placeholder="${esc(config.messagePlaceholder)}"></textarea>
      <button class="btn btn-primary" type="submit">${esc(config.submitLabel)}</button>
      <p class="form-note muted" data-aw-form-status></p>
    </form>
  </section>

  <footer class="site-footer container">
    <p>&copy; 2026 ${esc(config.brand)}. Built with AppWeaver AI.</p>
  </footer>

  <script src="script.js"></script>
</body>
</html>
`;

  const css = `:root{--accent:${config.accent};--text:${config.text ?? '#17171f'};--muted:${config.muted ?? '#5b5b6b'};--surface:${config.surface ?? '#ffffff'};--border:${config.border ?? '#e5e5ec'};--bg:${config.background ?? '#fafafc'}}
${baseReset}
body{background:var(--bg)}
.hero{padding:72px 0 48px}
`;

  return {
    slug: config.slug,
    name: config.name,
    description: config.description,
    kind: 'FULL_TEMPLATE',
    market: config.market,
    sortOrder: config.sortOrder,
    files: [
      { path: 'index.html', content: html },
      { path: 'styles.css', content: css },
      { path: 'script.js', content: navJs },
    ],
  };
}

const DARK = {
  background: '#0f1117',
  text: '#f2f3f7',
  surface: '#181b24',
  border: '#2a2f3d',
  muted: '#a3a9ba',
};

export const EXTRA_SITES: SiteConfig[] = [
  {
    slug: 'photographer-portfolio',
    name: 'Photographer Portfolio',
    description: 'A dark, gallery-first portfolio for photographers and visual artists.',
    market: 'FREELANCER',
    sortOrder: 10,
    brand: 'Maya Torres',
    pageTitle: 'Maya Torres — Photographer',
    headline: 'Wedding and portrait photography with an honest, natural look.',
    subhead: 'Based in your city and available worldwide. Tell me about your day and I will tell you how I would capture it.',
    cta: 'Check my availability',
    accent: '#f59e0b',
    ...DARK,
    sections: [
      {
        id: 'portfolio',
        title: 'Portfolio',
        intro: 'A few favourite collections. Replace these cards with your own galleries.',
        cards: [
          { title: 'Weddings', text: 'Relaxed, story-driven coverage from getting ready to the last dance.' },
          { title: 'Portraits', text: 'Individuals, couples and families photographed in natural light.' },
          { title: 'Editorial', text: 'Commissioned work for brands, magazines and local businesses.' },
        ],
      },
      {
        id: 'packages',
        title: 'Packages',
        cards: [
          { title: 'Mini session', text: '30 minutes, one location, 15 edited images.' },
          { title: 'Half day', text: 'Four hours of coverage and a full online gallery.' },
          { title: 'Full day', text: 'Complete coverage, a second photographer and a printed album.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'Maya made us feel at ease and the photos are beyond anything we hoped for.', by: 'Elena & Marc' },
      { quote: 'Professional, kind and incredibly quick to deliver.', by: 'Daniel R.' },
    ],
    contactTitle: 'Book a session',
    contactNote: 'Share your date and location and I will reply within one business day.',
    submitLabel: 'Send enquiry',
    messagePlaceholder: 'Date, location and what you have in mind',
  },
  {
    slug: 'developer-portfolio',
    name: 'Developer Portfolio',
    description: 'A focused portfolio for software developers with projects, skills and contact.',
    market: 'FREELANCER',
    sortOrder: 11,
    brand: 'Alex Chen',
    pageTitle: 'Alex Chen — Full-stack Developer',
    headline: 'I build fast, reliable web apps for product teams.',
    subhead: 'Full-stack developer with a focus on TypeScript, clean APIs and great user experience.',
    cta: 'Hire me',
    accent: '#22c55e',
    ...DARK,
    sections: [
      {
        id: 'projects',
        title: 'Projects',
        cards: [
          { title: 'Orbit — Analytics API', text: 'Event pipeline handling 20M requests a day with sub-50ms responses.' },
          { title: 'Fieldnote — Mobile web app', text: 'Offline-first notes app used by 12,000 field researchers.' },
          { title: 'Kiln — Developer tooling', text: 'Open-source CLI for deploying static sites in one command.' },
        ],
      },
      {
        id: 'skills',
        title: 'Skills',
        cards: [
          { title: 'Frontend', text: 'React, Next.js, TypeScript, accessibility and performance tuning.' },
          { title: 'Backend', text: 'Node.js, PostgreSQL, REST and GraphQL APIs, queues.' },
          { title: 'Delivery', text: 'CI/CD, testing, observability and pragmatic code reviews.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'Alex shipped our MVP in six weeks and the code was a pleasure to inherit.', by: 'Nadia, CTO' },
      { quote: 'Calm, communicative and consistently ahead of schedule.', by: 'Tom, Product Lead' },
    ],
    contactTitle: 'Start a project',
    contactNote: 'Tell me what you are building and when you need it.',
    submitLabel: 'Send message',
    messagePlaceholder: 'What are you building?',
  },
  {
    slug: 'restaurant-cafe',
    name: 'Restaurant & Cafe',
    description: 'A warm site for restaurants and cafes with menu highlights, hours and reservations.',
    market: 'SMALL_BUSINESS',
    sortOrder: 12,
    brand: 'Olive & Fig',
    pageTitle: 'Olive & Fig — Neighbourhood Kitchen',
    headline: 'Seasonal food, good coffee and a table waiting for you.',
    subhead: 'Open daily for breakfast, lunch and dinner. Walk-ins welcome, reservations recommended on weekends.',
    cta: 'Reserve a table',
    accent: '#b45309',
    background: '#fffaf3',
    border: '#f0e4d2',
    sections: [
      {
        id: 'menu',
        title: 'Menu highlights',
        cards: [
          { title: 'Breakfast', text: 'Shakshuka, sourdough toast with whipped ricotta and fresh pastries.' },
          { title: 'Lunch', text: 'Seasonal salads, wood-fired flatbreads and our daily soup.' },
          { title: 'Dinner', text: 'Slow-cooked lamb, handmade pasta and a rotating chef\'s special.' },
        ],
      },
      {
        id: 'visit',
        title: 'Visit us',
        cards: [
          { title: 'Hours', text: 'Mon–Fri 8am–10pm, Sat–Sun 9am–11pm.' },
          { title: 'Location', text: '12 Market Street, in the heart of the old town.' },
          { title: 'Private events', text: 'Our back room seats up to 24 guests for celebrations.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'The best brunch in town and the staff make you feel like a regular.', by: 'Hannah P.' },
      { quote: 'We hosted our anniversary dinner here. Flawless from start to finish.', by: 'The Okafor family' },
    ],
    contactTitle: 'Make a reservation',
    contactNote: 'Send your preferred date, time and party size and we will confirm by email.',
    submitLabel: 'Request table',
    messagePlaceholder: 'Date, time and number of guests',
  },
  {
    slug: 'fitness-studio',
    name: 'Fitness & Personal Trainer',
    description: 'An energetic site for gyms, studios and personal trainers with classes and memberships.',
    market: 'SMALL_BUSINESS',
    sortOrder: 13,
    brand: 'Pulse Studio',
    pageTitle: 'Pulse Studio — Strength & Conditioning',
    headline: 'Get stronger with coaching that fits your life.',
    subhead: 'Small-group classes and one-to-one training for every level. Your first class is free.',
    cta: 'Book a free class',
    accent: '#ef4444',
    sections: [
      {
        id: 'classes',
        title: 'Classes',
        cards: [
          { title: 'Strength', text: 'Barbell and kettlebell fundamentals taught in small groups.' },
          { title: 'HIIT', text: '40 minutes of high-intensity intervals for fat loss and stamina.' },
          { title: 'Mobility', text: 'Gentle stretching and recovery to keep you training pain-free.' },
        ],
      },
      {
        id: 'memberships',
        title: 'Memberships',
        cards: [
          { title: 'Drop-in', text: 'Pay per class with no commitment.' },
          { title: 'Monthly', text: 'Unlimited classes and a monthly progress check-in.' },
          { title: 'Personal training', text: 'One-to-one programme built around your goals.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'I have trained here for a year and I am fitter than I was at twenty-five.', by: 'Ruth M.' },
      { quote: 'Friendly coaches and zero ego. Exactly what I needed.', by: 'Chris W.' },
    ],
    contactTitle: 'Book your free class',
    contactNote: 'Tell us your goals and which class you would like to try.',
    submitLabel: 'Book now',
    messagePlaceholder: 'Your goals and preferred class time',
  },
  {
    slug: 'home-services',
    name: 'Home Services (Plumber, Electrician)',
    description: 'A trust-first site for tradespeople with services, guarantees and a quote request form.',
    market: 'SMALL_BUSINESS',
    sortOrder: 14,
    brand: 'Brightside Home Services',
    pageTitle: 'Brightside Home Services — Fast, Fair, Fixed',
    headline: 'Reliable repairs and installs from a local, insured team.',
    subhead: 'Same-day call-outs, upfront pricing and a 12-month guarantee on every job.',
    cta: 'Get a free quote',
    accent: '#0ea5e9',
    sections: [
      {
        id: 'services',
        title: 'Services',
        cards: [
          { title: 'Plumbing', text: 'Leaks, blocked drains, boiler servicing and bathroom fit-outs.' },
          { title: 'Electrical', text: 'Fault finding, rewiring, lighting and EV charger installs.' },
          { title: 'Emergency call-outs', text: 'Available evenings and weekends when you need us most.' },
        ],
      },
      {
        id: 'why-us',
        title: 'Why choose us',
        cards: [
          { title: 'Upfront pricing', text: 'A clear written quote before any work begins.' },
          { title: 'Fully insured', text: 'Qualified engineers with public liability cover.' },
          { title: '12-month guarantee', text: 'If something is not right, we come back and fix it free.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'Arrived within two hours and fixed our leak the same afternoon.', by: 'Sophie L.' },
      { quote: 'Tidy, polite and the price matched the quote exactly.', by: 'Mr. Adebayo' },
    ],
    contactTitle: 'Request a free quote',
    contactNote: 'Describe the job and we will reply with a price the same day.',
    submitLabel: 'Request quote',
    messagePlaceholder: 'What needs doing and where?',
  },
  {
    slug: 'beauty-salon',
    name: 'Beauty & Hair Salon',
    description: 'A soft, elegant site for salons, spas and beauty professionals with treatments and booking.',
    market: 'SMALL_BUSINESS',
    sortOrder: 15,
    brand: 'Lumière Salon',
    pageTitle: 'Lumière Salon — Hair, Skin & Nails',
    headline: 'Look and feel your best in a calm, welcoming space.',
    subhead: 'Expert stylists and therapists using gentle, high-quality products.',
    cta: 'Book an appointment',
    accent: '#db2777',
    background: '#fff7fa',
    border: '#f6dfe7',
    sections: [
      {
        id: 'treatments',
        title: 'Treatments',
        cards: [
          { title: 'Hair', text: 'Cuts, colour, balayage and restorative treatments.' },
          { title: 'Skin', text: 'Facials tailored to your skin type and goals.' },
          { title: 'Nails', text: 'Manicures, pedicures and long-lasting gel finishes.' },
        ],
      },
      {
        id: 'team',
        title: 'Meet the team',
        cards: [
          { title: 'Amira — Senior stylist', text: 'Colour specialist with 10 years of experience.' },
          { title: 'Jo — Skin therapist', text: 'Advanced facial and skin-health treatments.' },
          { title: 'Lena — Nail artist', text: 'Detailed nail art and natural-look finishes.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'The best colour I have ever had, and such a lovely atmosphere.', by: 'Isabel T.' },
      { quote: 'My skin has never looked better. Booking again already.', by: 'Priyanka S.' },
    ],
    contactTitle: 'Book your appointment',
    contactNote: 'Choose a treatment and a preferred time and we will confirm shortly.',
    submitLabel: 'Request booking',
    messagePlaceholder: 'Treatment and preferred date/time',
  },
  {
    slug: 'marketing-agency',
    name: 'Marketing Agency',
    description: 'A results-focused agency site with services, case studies and a lead form.',
    market: 'AGENCY',
    sortOrder: 16,
    brand: 'Northlight Marketing',
    pageTitle: 'Northlight Marketing — Growth for Ambitious Brands',
    headline: 'Marketing that turns attention into customers.',
    subhead: 'Strategy, paid media and content for brands that want measurable growth.',
    cta: 'Book a strategy call',
    accent: '#7c3aed',
    sections: [
      {
        id: 'services',
        title: 'Services',
        cards: [
          { title: 'Paid media', text: 'Search and social campaigns managed against clear revenue targets.' },
          { title: 'Content & SEO', text: 'Content programmes that earn traffic and compound over time.' },
          { title: 'Email & lifecycle', text: 'Automations that nurture leads and bring customers back.' },
        ],
      },
      {
        id: 'results',
        title: 'Recent results',
        cards: [
          { title: 'Harbor Coffee', text: 'Online sales up 148% in six months.' },
          { title: 'Fieldstone Legal', text: 'Qualified leads tripled at 40% lower cost per lead.' },
          { title: 'Kite Fitness', text: 'Grew from 2k to 30k email subscribers in a year.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'Northlight brought clarity and real numbers to our marketing.', by: 'Camila, Harbor Coffee' },
      { quote: 'A true partner. They treat our budget like their own.', by: 'David, Kite Fitness' },
    ],
    contactTitle: 'Let\'s talk growth',
    contactNote: 'Tell us about your business and goals. We reply within one business day.',
    submitLabel: 'Request a call',
    messagePlaceholder: 'About your business and goals',
  },
  {
    slug: 'mobile-app-landing',
    name: 'Mobile App Landing Page',
    description: 'A product landing page for a mobile app with features, how it works and a waitlist form.',
    market: 'SAAS',
    sortOrder: 17,
    brand: 'Tidy',
    pageTitle: 'Tidy — The Simplest Way to Plan Your Week',
    headline: 'Plan your week in two minutes and actually follow it.',
    subhead: 'Tidy turns your to-dos, calendar and habits into one clear daily plan. Coming soon to iOS and Android.',
    cta: 'Join the waitlist',
    accent: '#2563eb',
    sections: [
      {
        id: 'features',
        title: 'Features',
        cards: [
          { title: 'Smart daily plan', text: 'Tidy fits your tasks around your calendar automatically.' },
          { title: 'Gentle reminders', text: 'Nudges that arrive at the right moment, never nagging.' },
          { title: 'Habit streaks', text: 'Build routines with simple, motivating progress tracking.' },
        ],
      },
      {
        id: 'how-it-works',
        title: 'How it works',
        cards: [
          { title: '1. Add your tasks', text: 'Type or speak what is on your mind.' },
          { title: '2. Get your plan', text: 'Tidy schedules everything around your day.' },
          { title: '3. Stay on track', text: 'Check things off and watch your week come together.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'The first planner I have used for longer than a week.', by: 'Beta tester, Leila' },
      { quote: 'Simple, fast and genuinely calming.', by: 'Beta tester, Marcus' },
    ],
    contactTitle: 'Get early access',
    contactNote: 'Leave your email and we will invite you as soon as the app is ready.',
    submitLabel: 'Join waitlist',
    messagePlaceholder: 'Anything you would like to see in Tidy? (optional)',
  },
  {
    slug: 'nonprofit-charity',
    name: 'Nonprofit & Charity',
    description: 'A mission-driven site for nonprofits with impact stories, ways to help and contact.',
    market: 'GENERAL',
    sortOrder: 18,
    brand: 'Open Hands',
    pageTitle: 'Open Hands — Community Support Network',
    headline: 'Together we make sure no neighbour goes without.',
    subhead: 'We provide meals, mentoring and emergency support to families in our community.',
    cta: 'Get involved',
    accent: '#16a34a',
    background: '#f6fbf7',
    border: '#dcefe0',
    sections: [
      {
        id: 'impact',
        title: 'Our impact',
        cards: [
          { title: '48,000 meals', text: 'Shared with local families last year.' },
          { title: '320 volunteers', text: 'Giving their time every week.' },
          { title: '1,200 mentoring hours', text: 'Helping young people build confidence and skills.' },
        ],
      },
      {
        id: 'help',
        title: 'Ways to help',
        cards: [
          { title: 'Volunteer', text: 'Join a shift at our kitchen or mentoring programme.' },
          { title: 'Donate', text: 'Every contribution goes directly to local programmes.' },
          { title: 'Partner with us', text: 'Businesses and groups can sponsor events and drives.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'Open Hands helped my family through our hardest winter.', by: 'A local parent' },
      { quote: 'Volunteering here is the best part of my week.', by: 'Greg, volunteer' },
    ],
    contactTitle: 'Get in touch',
    contactNote: 'Ask a question, offer help or tell us how we can support you.',
    submitLabel: 'Send message',
    messagePlaceholder: 'How can we help?',
  },
  {
    slug: 'event-conference',
    name: 'Event & Conference',
    description: 'An event landing page with schedule highlights, speakers and a registration form.',
    market: 'GENERAL',
    sortOrder: 19,
    brand: 'Summit 2027',
    pageTitle: 'Summit 2027 — Two Days of Ideas That Matter',
    headline: 'Two days. Thirty speakers. One community.',
    subhead: 'Join us on 14–15 May for talks, workshops and conversations on the future of design and technology.',
    cta: 'Register now',
    accent: '#f97316',
    ...DARK,
    sections: [
      {
        id: 'schedule',
        title: 'Schedule highlights',
        cards: [
          { title: 'Day 1 — Keynotes', text: 'Opening keynote, panel discussions and an evening reception.' },
          { title: 'Day 2 — Workshops', text: 'Hands-on sessions led by industry practitioners.' },
          { title: 'Closing party', text: 'Celebrate with music, food and new friends.' },
        ],
      },
      {
        id: 'speakers',
        title: 'Speakers',
        cards: [
          { title: 'Dr. Ana Silva', text: 'Head of Research, Lumen Labs.' },
          { title: 'Kofi Mensah', text: 'Design Director, Bright Studio.' },
          { title: 'Mei Lin', text: 'Founder, Open Source Collective.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'The most inspiring event I attended all year.', by: 'Attendee, 2026' },
      { quote: 'Brilliant speakers and a genuinely friendly crowd.', by: 'Speaker, 2026' },
    ],
    contactTitle: 'Register your interest',
    contactNote: 'Share your details and we will send ticket information as soon as it is available.',
    submitLabel: 'Register',
    messagePlaceholder: 'Anything we should know? (optional)',
  },
  {
    slug: 'life-coach',
    name: 'Coach & Consultant',
    description: 'A personal-brand site for coaches and consultants with offers, process and booking.',
    market: 'FREELANCER',
    sortOrder: 20,
    brand: 'Sam Rivera Coaching',
    pageTitle: 'Sam Rivera — Career & Leadership Coach',
    headline: 'Clarity, confidence and a plan for your next career move.',
    subhead: 'One-to-one coaching for professionals and new leaders who want to grow without burning out.',
    cta: 'Book a discovery call',
    accent: '#0d9488',
    sections: [
      {
        id: 'coaching',
        title: 'How I can help',
        cards: [
          { title: 'Career change', text: 'Find direction, update your story and land the right role.' },
          { title: 'New leaders', text: 'Build the skills and habits to lead your team well.' },
          { title: 'Team workshops', text: 'Practical sessions on feedback, communication and focus.' },
        ],
      },
      {
        id: 'process',
        title: 'My process',
        cards: [
          { title: '1. Discover', text: 'A free call to understand where you are and where you want to be.' },
          { title: '2. Plan', text: 'Set clear goals and a realistic roadmap together.' },
          { title: '3. Grow', text: 'Regular sessions with accountability and practical tools.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'Sam helped me change careers with confidence. Life-changing.', by: 'Olivia, Product Manager' },
      { quote: 'Practical, warm and direct. My team noticed the difference.', by: 'Raj, Engineering Lead' },
    ],
    contactTitle: 'Book a free discovery call',
    contactNote: 'Tell me a little about your situation and I will reply within two business days.',
    submitLabel: 'Request a call',
    messagePlaceholder: 'What would you like help with?',
  },
  {
    slug: 'dental-clinic',
    name: 'Dental & Medical Clinic',
    description: 'A calm, trustworthy site for clinics with treatments, team and appointment requests.',
    market: 'SMALL_BUSINESS',
    sortOrder: 21,
    brand: 'Clearview Dental',
    pageTitle: 'Clearview Dental — Gentle Family Dentistry',
    headline: 'Gentle, modern dental care for the whole family.',
    subhead: 'New patients welcome. Same-week appointments, clear pricing and no-rush check-ups.',
    cta: 'Request an appointment',
    accent: '#0891b2',
    background: '#f5fbfd',
    border: '#d8eef4',
    sections: [
      {
        id: 'treatments',
        title: 'Treatments',
        cards: [
          { title: 'Check-ups & cleaning', text: 'Preventive care to keep your smile healthy.' },
          { title: 'Whitening & cosmetic', text: 'Safe, effective options for a brighter smile.' },
          { title: 'Orthodontics', text: 'Clear aligners and braces for children and adults.' },
        ],
      },
      {
        id: 'visit',
        title: 'Your first visit',
        cards: [
          { title: 'Welcome & consultation', text: 'We listen to your concerns and answer every question.' },
          { title: 'Thorough examination', text: 'Digital x-rays and a full oral health check.' },
          { title: 'Clear plan', text: 'A written treatment plan with transparent pricing.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'I used to dread the dentist. Not anymore. Everyone is so kind.', by: 'Patricia K.' },
      { quote: 'Great with our kids and always on time.', by: 'The Nguyen family' },
    ],
    contactTitle: 'Request an appointment',
    contactNote: 'Send your preferred days and we will confirm by phone or email.',
    submitLabel: 'Request appointment',
    messagePlaceholder: 'Preferred days/times and reason for visit',
  },
  {
    slug: 'real-estate-agent',
    name: 'Real Estate Agent',
    description: 'A listings-focused site for agents with featured homes, services and enquiries.',
    market: 'SMALL_BUSINESS',
    sortOrder: 22,
    brand: 'Harper & Co. Homes',
    pageTitle: 'Harper & Co. Homes — Buy, Sell, Rent',
    headline: 'Find the right home, or the right buyer, with local experts.',
    subhead: 'Personal service backed by deep knowledge of the neighbourhoods we work in.',
    cta: 'Talk to an agent',
    accent: '#1d4ed8',
    sections: [
      {
        id: 'listings',
        title: 'Featured homes',
        intro: 'Replace these with your current listings.',
        cards: [
          { title: '3-bed family home', text: 'Bright and spacious with a south-facing garden, close to schools.' },
          { title: 'City centre apartment', text: 'Modern two-bedroom with balcony and secure parking.' },
          { title: 'Country cottage', text: 'Charming period property on a generous plot.' },
        ],
      },
      {
        id: 'services',
        title: 'Our services',
        cards: [
          { title: 'Selling', text: 'Free valuation, professional marketing and expert negotiation.' },
          { title: 'Buying', text: 'Property search, viewings and guidance through every step.' },
          { title: 'Renting', text: 'Tenant finding, referencing and full property management.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'They sold our home in nine days, above asking price.', by: 'Mark & Jenny' },
      { quote: 'Patient and honest. We found our dream flat thanks to them.', by: 'Yusuf A.' },
    ],
    contactTitle: 'Speak to an agent',
    contactNote: 'Tell us if you are buying, selling or renting and we will call you back.',
    submitLabel: 'Send enquiry',
    messagePlaceholder: 'Buying, selling or renting? Area and budget?',
  },
  {
    slug: 'wedding-invitation',
    name: 'Wedding Website',
    description: 'A romantic wedding site with the story, schedule, details and RSVP form.',
    market: 'GENERAL',
    sortOrder: 23,
    brand: 'Emma & Luca',
    pageTitle: 'Emma & Luca — We Are Getting Married',
    headline: 'Emma & Luca are getting married. Join us for the celebration.',
    subhead: 'Saturday 12 September 2027 at Willow Hall. Dinner and dancing to follow.',
    cta: 'RSVP',
    accent: '#be185d',
    background: '#fffafb',
    border: '#f4e1e7',
    sections: [
      {
        id: 'story',
        title: 'Our story',
        cards: [
          { title: 'How we met', text: 'A rainy day, a shared umbrella and a coffee that lasted four hours.' },
          { title: 'The proposal', text: 'On a quiet hillside at sunset with only the dog watching.' },
          { title: 'The big day', text: 'We cannot wait to celebrate with the people we love most.' },
        ],
      },
      {
        id: 'details',
        title: 'The day',
        cards: [
          { title: 'Ceremony — 2pm', text: 'Willow Hall gardens. Please arrive by 1:30pm.' },
          { title: 'Reception — 5pm', text: 'Dinner, speeches and dancing in the main hall.' },
          { title: 'Travel & stay', text: 'Rooms are held at The Old Mill until 1 August.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'We could not be happier to share this day with you.', by: 'Emma & Luca' },
      { quote: 'Dress code: smart and comfortable. Dancing shoes encouraged.', by: 'The couple' },
    ],
    contactTitle: 'RSVP',
    contactNote: 'Please let us know if you can join us by 1 July.',
    submitLabel: 'Send RSVP',
    messagePlaceholder: 'Names, dietary requirements and any message for us',
  },
  {
    slug: 'online-course',
    name: 'Online Course Landing Page',
    description: 'A landing page to sell an online course or workshop with curriculum and sign-up.',
    market: 'SAAS',
    sortOrder: 24,
    brand: 'Learn Design',
    pageTitle: 'Learn Design — Become a Confident UI Designer',
    headline: 'Learn UI design in six weeks, with real projects for your portfolio.',
    subhead: 'A live, cohort-based course with weekly feedback from working designers.',
    cta: 'Save my seat',
    accent: '#9333ea',
    sections: [
      {
        id: 'curriculum',
        title: 'What you will learn',
        cards: [
          { title: 'Weeks 1–2: Foundations', text: 'Layout, type, colour and design systems.' },
          { title: 'Weeks 3–4: Real projects', text: 'Design a mobile app and a marketing site end to end.' },
          { title: 'Weeks 5–6: Portfolio', text: 'Polish your work and prepare for interviews.' },
        ],
      },
      {
        id: 'included',
        title: 'What is included',
        cards: [
          { title: 'Live sessions', text: 'Two live workshops a week, recorded for later.' },
          { title: 'Feedback', text: 'Personal critique on every project you submit.' },
          { title: 'Community', text: 'A private group to learn alongside your cohort.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'I landed my first design job two months after finishing.', by: 'Tasha, graduate' },
      { quote: 'The feedback alone was worth the price.', by: 'Ben, graduate' },
    ],
    contactTitle: 'Reserve your place',
    contactNote: 'The next cohort starts soon and places are limited.',
    submitLabel: 'Reserve my place',
    messagePlaceholder: 'Tell us about your experience (optional)',
  },
  {
    slug: 'design-studio',
    name: 'Design Studio',
    description: 'A bold studio site with services, selected work and a project enquiry form.',
    market: 'AGENCY',
    sortOrder: 25,
    brand: 'Form & Function',
    pageTitle: 'Form & Function — Brand and Web Design Studio',
    headline: 'We design brands and websites people remember.',
    subhead: 'A small senior team crafting identities, websites and product experiences.',
    cta: 'Start a project',
    accent: '#e11d48',
    ...DARK,
    sections: [
      {
        id: 'work',
        title: 'Selected work',
        cards: [
          { title: 'Alder & Oak', text: 'Brand identity and e-commerce site for a furniture maker.' },
          { title: 'Meridian Bank', text: 'Product design for a new mobile banking experience.' },
          { title: 'Wildlands Trust', text: 'A campaign website that doubled donations.' },
        ],
      },
      {
        id: 'services',
        title: 'What we do',
        cards: [
          { title: 'Brand identity', text: 'Strategy, naming, logo and visual systems.' },
          { title: 'Web design', text: 'Fast, accessible sites built to convert.' },
          { title: 'Product design', text: 'Research-led interfaces for apps and platforms.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'They understood our brand better than we did.', by: 'Clara, Alder & Oak' },
      { quote: 'Sharp, collaborative and on time.', by: 'Imran, Meridian Bank' },
    ],
    contactTitle: 'Tell us about your project',
    contactNote: 'Share your goals, timeline and budget range and we will be in touch.',
    submitLabel: 'Send brief',
    messagePlaceholder: 'Your project, timeline and budget',
  },
  {
    slug: 'construction-contractor',
    name: 'Construction & Renovation',
    description: 'A solid, trust-building site for builders and renovators with services, process and a quote form.',
    market: 'SMALL_BUSINESS',
    sortOrder: 26,
    brand: 'Ironwood Construction',
    pageTitle: 'Ironwood Construction — Building and Renovation You Can Trust',
    headline: 'Quality building work, delivered on time and on budget.',
    subhead: 'Extensions, renovations and new builds by a licensed, fully insured local team.',
    cta: 'Request a quote',
    accent: '#d97706',
    sections: [
      {
        id: 'services',
        title: 'What we build',
        cards: [
          { title: 'Extensions', text: 'Add space and value with a well-planned home extension.' },
          { title: 'Renovations', text: 'Kitchens, bathrooms and full-home refurbishments.' },
          { title: 'New builds', text: 'From groundworks to handover, managed end to end.' },
        ],
      },
      {
        id: 'process',
        title: 'How it works',
        cards: [
          { title: '1. Site visit', text: 'We assess the job and listen to what you need.' },
          { title: '2. Fixed quote', text: 'A clear written price and timeline before we start.' },
          { title: '3. Build and handover', text: 'Regular updates and a final walkthrough with you.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'Our extension finished a week early and the finish is superb.', by: 'Helen and Paul R.' },
      { quote: 'Honest pricing and a very tidy site throughout.', by: 'Mr. Okafor' },
    ],
    contactTitle: 'Get a free site visit',
    contactNote: 'Tell us about your project and we will arrange a visit and quote.',
    submitLabel: 'Request quote',
    messagePlaceholder: 'Describe the work and your location',
  },
  {
    slug: 'repair-services',
    name: 'Repair Shop (Phones, Appliances, Auto)',
    description: 'A clear, fast-to-scan site for repair businesses with common repairs, turnaround times and a booking form.',
    market: 'SMALL_BUSINESS',
    sortOrder: 27,
    brand: 'FixRight Repairs',
    pageTitle: 'FixRight Repairs — Fast, Warrantied Repairs',
    headline: 'Broken? We will have it working again, fast.',
    subhead: 'Same-day repairs, honest diagnostics and a 90-day warranty on every fix.',
    cta: 'Book a repair',
    accent: '#16a34a',
    sections: [
      {
        id: 'repairs',
        title: 'Common repairs',
        cards: [
          { title: 'Phones and tablets', text: 'Screens, batteries and charging ports, often within the hour.' },
          { title: 'Appliances', text: 'Washers, fridges and ovens diagnosed and repaired.' },
          { title: 'Vehicles', text: 'Servicing, brakes and diagnostics by qualified mechanics.' },
        ],
      },
      {
        id: 'why-us',
        title: 'Why customers choose us',
        cards: [
          { title: 'Free diagnosis', text: 'No fix, no fee on every quote.' },
          { title: '90-day warranty', text: 'We stand behind every repair we make.' },
          { title: 'Quick turnaround', text: 'Most jobs are completed the same day.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'My phone was fixed in 40 minutes and works like new.', by: 'Tanya B.' },
      { quote: 'Fair price and they explained exactly what was wrong.', by: 'Daniel K.' },
    ],
    contactTitle: 'Book your repair',
    contactNote: 'Tell us what is broken and when you can drop it off.',
    submitLabel: 'Book repair',
    messagePlaceholder: 'Item, make or model, and what is wrong',
  },
  {
    slug: 'personal-website',
    name: 'Personal Website & Profile',
    description: 'A simple professional profile with a short bio, skills, experience and a contact form.',
    market: 'FREELANCER',
    sortOrder: 28,
    brand: 'Alex Morgan',
    pageTitle: 'Alex Morgan — Professional Profile',
    headline: 'Hi, I am Alex. I help teams turn ideas into results.',
    subhead: 'Product professional with 8 years of experience across startups and agencies.',
    cta: 'Get in touch',
    accent: '#2563eb',
    sections: [
      {
        id: 'about',
        title: 'About me',
        cards: [
          { title: 'Background', text: 'A short summary of your career and what drives you.' },
          { title: 'Approach', text: 'How you work with clients and colleagues.' },
          { title: 'Outside work', text: 'A personal touch that makes you memorable.' },
        ],
      },
      {
        id: 'skills',
        title: 'Skills and experience',
        cards: [
          { title: 'Strategy', text: 'Research, roadmaps and prioritisation.' },
          { title: 'Delivery', text: 'Leading cross-functional teams to ship on time.' },
          { title: 'Communication', text: 'Clear writing, workshops and stakeholder updates.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'Alex brought calm and clarity to a complicated project.', by: 'Priya, Northwind' },
      { quote: 'One of the best collaborators I have worked with.', by: 'Tom, Studio Nine' },
    ],
    contactTitle: 'Let us talk',
    contactNote: 'Send a message about your project or opportunity.',
    submitLabel: 'Send message',
    messagePlaceholder: 'How can I help?',
  },
  {
    slug: 'freelance-writer',
    name: 'Freelance Writer & Consultant',
    description: 'A clean site for writers, consultants and coaches with services, selected work and an enquiry form.',
    market: 'FREELANCER',
    sortOrder: 29,
    brand: 'Jordan Ellis',
    pageTitle: 'Jordan Ellis — Writing and Content Strategy',
    headline: 'Words that make your business easier to understand.',
    subhead: 'Copywriting, articles and content strategy for B2B and consumer brands.',
    cta: 'Request a proposal',
    accent: '#9333ea',
    background: '#fcfaff',
    sections: [
      {
        id: 'services',
        title: 'Services',
        cards: [
          { title: 'Website copy', text: 'Clear, persuasive pages that convert visitors.' },
          { title: 'Articles and blogs', text: 'Researched long-form content that ranks and reads well.' },
          { title: 'Content strategy', text: 'A plan for what to publish, where and when.' },
        ],
      },
      {
        id: 'work',
        title: 'Selected work',
        cards: [
          { title: 'SaaS launch copy', text: 'Messaging that lifted sign-ups by 32 percent.' },
          { title: 'Thought-leadership series', text: 'Twelve articles for a fintech founder.' },
          { title: 'Brand voice guide', text: 'A practical guide used across a 40-person team.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'Jordan nailed our tone on the first draft.', by: 'Mia, Brightpath' },
      { quote: 'Fast, thoughtful and a pleasure to work with.', by: 'Samuel, Lumen Labs' },
    ],
    contactTitle: 'Request a proposal',
    contactNote: 'Tell me about your project, audience and deadline.',
    submitLabel: 'Request proposal',
    messagePlaceholder: 'Your project, audience and deadline',
  },
  {
    slug: 'freelance-designer',
    name: 'Freelance Designer & Illustrator',
    description: 'A bold, visual site for designers and illustrators with services, process and project showcase.',
    market: 'FREELANCER',
    sortOrder: 30,
    brand: 'Sam Rivera Design',
    pageTitle: 'Sam Rivera — Brand and Graphic Designer',
    headline: 'Design that gives your brand a voice people remember.',
    subhead: 'Logos, brand identities and social graphics for growing businesses.',
    cta: 'Start a project',
    accent: '#e11d48',
    sections: [
      {
        id: 'work',
        title: 'Featured projects',
        cards: [
          { title: 'Harvest Kitchen', text: 'Brand identity and packaging for a food start-up.' },
          { title: 'Northline Fitness', text: 'Logo, colour system and social templates.' },
          { title: 'Paper and Pine', text: 'Stationery and illustrated website graphics.' },
        ],
      },
      {
        id: 'process',
        title: 'My process',
        cards: [
          { title: 'Discover', text: 'We define your goals, audience and style.' },
          { title: 'Design', text: 'Concepts, feedback rounds and refinement.' },
          { title: 'Deliver', text: 'Final files and a simple brand guide.' },
        ],
      },
    ],
    testimonials: [
      { quote: 'Our new logo has had compliments from every customer.', by: 'Nadia, Harvest Kitchen' },
      { quote: 'Great communication and beautiful work.', by: 'Luke, Northline' },
    ],
    contactTitle: 'Start a project',
    contactNote: 'Share what you need and your timeline for a quote.',
    submitLabel: 'Start project',
    messagePlaceholder: 'What do you need designed?',
  },
];

function section(
  slug: string,
  name: string,
  description: string,
  sortOrder: number,
  content: string,
): GeneratedTemplate {
  return {
    slug,
    name,
    description,
    kind: 'SECTION',
    market: 'GENERAL',
    sortOrder,
    files: [{ path: 'section.html', content }],
  };
}

export const EXTRA_SECTIONS: GeneratedTemplate[] = [
  section(
    'section-stats',
    'Stats Bar',
    'Three headline numbers that build trust.',
    10,
    `<section class="tpl-section tpl-stats">
  <style>
    .tpl-stats{padding:48px 24px;background:#4f46e5;color:#fff}
    .tpl-stats .tpl-inner{max-width:900px;margin:0 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;text-align:center}
    @media (max-width:640px){.tpl-stats .tpl-inner{grid-template-columns:1fr}}
    .tpl-stats strong{display:block;font-size:2.2rem;font-weight:800}
    .tpl-stats span{opacity:.9}
  </style>
  <div class="tpl-inner">
    <div><strong>500+</strong><span>Happy customers</span></div>
    <div><strong>10 years</strong><span>In business</span></div>
    <div><strong>4.9/5</strong><span>Average rating</span></div>
  </div>
</section>
`,
  ),
  section(
    'section-newsletter',
    'Newsletter Signup',
    'An email sign-up block that collects submissions.',
    11,
    `<section class="tpl-section tpl-newsletter">
  <style>
    .tpl-newsletter{padding:56px 24px;background:#f7f7fb;text-align:center}
    .tpl-newsletter .tpl-inner{max-width:480px;margin:0 auto}
    .tpl-newsletter h2{font-size:1.6rem;font-weight:700;margin-bottom:8px}
    .tpl-newsletter p{color:#5b5b6b;margin-bottom:18px}
    .tpl-newsletter form{display:flex;gap:8px}
    .tpl-newsletter input{flex:1;padding:12px 14px;border-radius:8px;border:1px solid #dcdce6;font:inherit}
    .tpl-newsletter button{padding:12px 20px;border-radius:8px;background:#4f46e5;color:#fff;font-weight:600;border:none;cursor:pointer}
    .tpl-newsletter .tpl-note{margin-top:10px;font-size:.9rem;min-height:1.2em}
  </style>
  <div class="tpl-inner">
    <h2>Stay in the loop</h2>
    <p>Get news and updates straight to your inbox.</p>
    <form data-aw-form="newsletter">
      <input type="email" name="email" placeholder="you@example.com" required />
      <button type="submit">Subscribe</button>
    </form>
    <p class="tpl-note" data-aw-form-status></p>
  </div>
</section>
`,
  ),
  section(
    'section-logos',
    'Trusted By Logos',
    'A row of client or partner names.',
    12,
    `<section class="tpl-section tpl-logos">
  <style>
    .tpl-logos{padding:40px 24px;background:#fff;text-align:center}
    .tpl-logos p{color:#7a7a8c;font-size:.85rem;text-transform:uppercase;letter-spacing:.08em;margin-bottom:18px}
    .tpl-logos ul{list-style:none;display:flex;flex-wrap:wrap;justify-content:center;gap:12px 36px;max-width:900px;margin:0 auto;padding:0}
    .tpl-logos li{font-weight:700;font-size:1.15rem;color:#9a9aab}
  </style>
  <p>Trusted by teams at</p>
  <ul><li>Northwind</li><li>Arclight</li><li>Petal</li><li>Harbor</li><li>Kite</li></ul>
</section>
`,
  ),
  section(
    'section-process',
    'Process Steps',
    'Three numbered steps explaining how you work.',
    13,
    `<section class="tpl-section tpl-process">
  <style>
    .tpl-process{padding:64px 24px;background:#fff}
    .tpl-process .tpl-inner{max-width:1000px;margin:0 auto}
    .tpl-process h2{font-size:1.75rem;font-weight:700;margin-bottom:32px;text-align:center}
    .tpl-process .tpl-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
    @media (max-width:760px){.tpl-process .tpl-steps{grid-template-columns:1fr}}
    .tpl-process .tpl-num{width:36px;height:36px;border-radius:50%;background:#4f46e5;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;margin-bottom:10px}
    .tpl-process p{color:#5b5b6b}
  </style>
  <div class="tpl-inner">
    <h2>How it works</h2>
    <div class="tpl-steps">
      <div><div class="tpl-num">1</div><h3>Tell us what you need</h3><p>Share your goals and timeline.</p></div>
      <div><div class="tpl-num">2</div><h3>We get to work</h3><p>You see progress at every step.</p></div>
      <div><div class="tpl-num">3</div><h3>Launch and improve</h3><p>We refine based on real feedback.</p></div>
    </div>
  </div>
</section>
`,
  ),
];
