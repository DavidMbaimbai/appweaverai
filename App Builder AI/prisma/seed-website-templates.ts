/**
 * Seeds the website template/section library (prisma/schema.prisma:
 * WebsiteTemplate / WebsiteTemplateFile). Run with:
 *
 *   node prisma/seed-website-templates.ts
 *
 * Idempotent: upserts by slug, replacing file contents each run, so it is
 * safe to re-run after editing the template content below.
 */
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });

import { prisma } from '../lib/prisma';
import {
  buildSite,
  EXTRA_SECTIONS,
  EXTRA_SITES,
} from './seed-extra-templates';
import type {
  TemplateKind,
  TemplateMarket,
} from '../lib/generated/prisma/client';

type TemplateFileDef = { path: string; content: string };
type TemplateDef = {
  slug: string;
  name: string;
  description: string;
  kind: TemplateKind;
  market: TemplateMarket;
  sortOrder: number;
  files: TemplateFileDef[];
};

const BASE_RESET = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;line-height:1.5;color:var(--text)}
img{max-width:100%;display:block}
a{color:inherit;text-decoration:none}
ul{list-style:none}
.container{max-width:1100px;margin:0 auto;padding:0 24px}
.btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 24px;border-radius:8px;font-weight:600;border:none;cursor:pointer;transition:transform .15s ease,opacity .15s ease}
.btn:hover{transform:translateY(-1px)}
.btn-primary{background:var(--accent);color:#fff}
.btn-secondary{background:transparent;color:var(--accent);border:2px solid var(--accent)}
nav.site-nav{display:flex;align-items:center;justify-content:space-between;padding:20px 0}
nav.site-nav .logo{font-weight:700;font-size:1.25rem}
nav.site-nav ul{display:flex;gap:28px}
@media (max-width:720px){nav.site-nav ul{display:none}}
section{padding:72px 0}
h1{font-size:clamp(2rem,5vw,3.25rem);font-weight:800;line-height:1.1}
h2{font-size:clamp(1.5rem,3vw,2.25rem);font-weight:700;margin-bottom:12px}
.muted{color:var(--muted)}
.grid{display:grid;gap:24px}
.grid-3{grid-template-columns:repeat(3,1fr)}
@media (max-width:860px){.grid-3{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px}
footer.site-footer{padding:40px 0;border-top:1px solid var(--border);text-align:center;color:var(--muted)}
form.contact-form{display:flex;flex-direction:column;gap:14px;max-width:480px}
form.contact-form input,form.contact-form textarea{padding:12px 14px;border-radius:8px;border:1px solid var(--border);font:inherit;background:var(--surface);color:var(--text)}
.form-note{font-size:.9rem;color:var(--muted)}
.form-note.aw-form-error{color:#dc2626}`;

const MOBILE_NAV_JS = `document.addEventListener('DOMContentLoaded', function () {
  var form = document.querySelector('.contact-form');
  if (!form) return;
  // Fallback for environments where the editor's generic form-submit shim
  // never attaches (e.g. downloaded/exported HTML with no project id to
  // post to): give the shim a brief moment to attach (it sets
  // data-aw-handled on the form), then fall back to a no-op "thanks"
  // message so the form still feels responsive.
  setTimeout(function () {
    if (form.hasAttribute('data-aw-handled')) return;
    form.setAttribute('data-aw-handled', 'true');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var note = form.querySelector('.form-note');
      if (note) note.textContent = "Thanks! We'll be in touch soon.";
      form.reset();
    });
  }, 300);
});`;

const templates: TemplateDef[] = [
  // ---------------------------------------------------------------------
  // Full templates
  // ---------------------------------------------------------------------
  {
    slug: 'freelancer-portfolio',
    name: 'Freelancer Portfolio',
    description:
      'A clean personal portfolio for freelancers to showcase projects, skills, and client testimonials.',
    kind: 'FULL_TEMPLATE',
    market: 'FREELANCER',
    sortOrder: 1,
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Jordan Lee — Product Designer</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="container">
    <nav class="site-nav">
      <span class="logo">Jordan Lee</span>
      <ul>
        <li><a href="#work">Work</a></li>
        <li><a href="#about">About</a></li>
        <li><a href="#testimonials">Testimonials</a></li>
        <li><a href="#contact">Contact</a></li>
      </ul>
    </nav>
  </header>

  <section class="hero container">
    <h1>Hi, I'm Jordan — a product designer who helps startups ship clearer, better-looking products.</h1>
    <p class="muted" style="margin-top:16px;max-width:560px">I design websites, apps, and brand systems for founders who need to move fast without sacrificing quality.</p>
    <div style="margin-top:28px;display:flex;gap:16px">
      <a class="btn btn-primary" href="#contact">Work with me</a>
      <a class="btn btn-secondary" href="#work">See my work</a>
    </div>
  </section>

  <section id="work" class="container">
    <h2>Selected projects</h2>
    <div class="grid grid-3">
      <article class="card">
        <h3>Northwind — SaaS dashboard</h3>
        <p class="muted" style="margin-top:8px">Redesigned the core analytics dashboard, improving task completion by 32%.</p>
      </article>
      <article class="card">
        <h3>Petal — Mobile app</h3>
        <p class="muted" style="margin-top:8px">Designed the onboarding and checkout flow for a plant-care subscription app.</p>
      </article>
      <article class="card">
        <h3>Arclight — Brand identity</h3>
        <p class="muted" style="margin-top:8px">Built a full brand system: logo, type, color, and a 12-page style guide.</p>
      </article>
    </div>
  </section>

  <section id="about" class="container">
    <h2>About me</h2>
    <p class="muted" style="max-width:640px">I'm a product designer with 6 years of experience working with early-stage startups. I care about clarity, speed, and making sure design decisions are backed by real user feedback.</p>
  </section>

  <section id="testimonials" class="container">
    <h2>What clients say</h2>
    <div class="grid grid-3">
      <div class="card">
        <p>"Jordan turned a messy idea into a product people actually understand."</p>
        <p class="muted" style="margin-top:12px">— Priya, Founder at Northwind</p>
      </div>
      <div class="card">
        <p>"Fast, thoughtful, and easy to work with from day one."</p>
        <p class="muted" style="margin-top:12px">— Sam, CEO at Petal</p>
      </div>
    </div>
  </section>

  <section id="contact" class="container">
    <h2>Let's work together</h2>
    <p class="muted" style="margin-bottom:20px">Tell me a bit about your project and I'll get back to you within two business days.</p>
    <form class="contact-form" data-aw-form="contact">
      <input type="text" name="name" placeholder="Your name" required />
      <input type="email" name="email" placeholder="Your email" required />
      <textarea rows="4" name="message" placeholder="Tell me about your project"></textarea>
      <button class="btn btn-primary" type="submit">Send message</button>
      <p class="form-note muted" data-aw-form-status></p>
    </form>
  </section>

  <footer class="site-footer container">
    <p>&copy; 2026 Jordan Lee. Built with AppWeaver AI.</p>
  </footer>

  <script src="script.js"></script>
</body>
</html>
`,
      },
      {
        path: 'styles.css',
        content: `:root{--accent:#4f46e5;--text:#17171f;--muted:#5b5b6b;--surface:#ffffff;--border:#e5e5ec;--bg:#fafafc}
${BASE_RESET}
body{background:var(--bg)}
.hero{padding:72px 0 48px}
`,
      },
      { path: 'script.js', content: MOBILE_NAV_JS },
    ],
  },
  {
    slug: 'small-business-cleaning',
    name: 'Cleaning Service',
    description:
      'A trust-building small-business site for home and office cleaning companies, with services, pricing, and a quote form.',
    kind: 'FULL_TEMPLATE',
    market: 'SMALL_BUSINESS',
    sortOrder: 2,
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sparkle Clean — Professional Cleaning Services</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="container">
    <nav class="site-nav">
      <span class="logo">✨ Sparkle Clean</span>
      <ul>
        <li><a href="#services">Services</a></li>
        <li><a href="#why-us">Why Us</a></li>
        <li><a href="#testimonials">Reviews</a></li>
        <li><a href="#contact">Get a Quote</a></li>
      </ul>
    </nav>
  </header>

  <section class="hero container">
    <h1>Professional cleaning services you can trust.</h1>
    <p class="muted" style="margin-top:16px;max-width:560px">Homes and offices cleaned by a vetted, insured team — on your schedule, every time.</p>
    <div style="margin-top:28px;display:flex;gap:16px">
      <a class="btn btn-primary" href="#contact">Get a Free Quote</a>
      <a class="btn btn-secondary" href="#services">Our Services</a>
    </div>
  </section>

  <section id="services" class="container">
    <h2>Our services</h2>
    <div class="grid grid-3">
      <div class="card"><h3>Home Cleaning</h3><p class="muted" style="margin-top:8px">Regular or one-time cleaning for every room in your home.</p></div>
      <div class="card"><h3>Office Cleaning</h3><p class="muted" style="margin-top:8px">Keep your workplace spotless with flexible weekly plans.</p></div>
      <div class="card"><h3>Deep Cleaning</h3><p class="muted" style="margin-top:8px">A thorough, top-to-bottom clean for move-ins, move-outs, or spring cleaning.</p></div>
    </div>
  </section>

  <section id="why-us" class="container">
    <h2>Why choose us</h2>
    <div class="grid grid-3">
      <div class="card"><h3>Insured &amp; Bonded</h3><p class="muted" style="margin-top:8px">Full insurance coverage for total peace of mind.</p></div>
      <div class="card"><h3>Satisfaction Guaranteed</h3><p class="muted" style="margin-top:8px">Not happy? We'll come back and make it right, free of charge.</p></div>
      <div class="card"><h3>Flexible Scheduling</h3><p class="muted" style="margin-top:8px">Weekly, bi-weekly, monthly, or one-off bookings.</p></div>
    </div>
  </section>

  <section id="testimonials" class="container">
    <h2>What our customers say</h2>
    <div class="grid grid-3">
      <div class="card"><p>"Reliable and incredibly thorough. Our office has never looked better."</p><p class="muted" style="margin-top:12px">— Maria T.</p></div>
      <div class="card"><p>"Booking was easy and the team showed up right on time."</p><p class="muted" style="margin-top:12px">— David K.</p></div>
    </div>
  </section>

  <section id="contact" class="container">
    <h2>Get your free quote</h2>
    <p class="muted" style="margin-bottom:20px">Tell us about your space and we'll send a free, no-obligation quote.</p>
    <form class="contact-form" data-aw-form="contact">
      <input type="text" name="name" placeholder="Your name" required />
      <input type="tel" name="phone" placeholder="Phone number" required />
      <input type="text" name="address" placeholder="Address or neighborhood" />
      <textarea rows="4" name="message" placeholder="What do you need cleaned?"></textarea>
      <button class="btn btn-primary" type="submit">Request a Quote</button>
      <p class="form-note muted" data-aw-form-status></p>
    </form>
  </section>

  <footer class="site-footer container">
    <p>&copy; 2026 Sparkle Clean. Built with AppWeaver AI.</p>
  </footer>

  <script src="script.js"></script>
</body>
</html>
`,
      },
      {
        path: 'styles.css',
        content: `:root{--accent:#0d9488;--text:#132421;--muted:#53625f;--surface:#ffffff;--border:#dce7e4;--bg:#f4faf9}
${BASE_RESET}
body{background:var(--bg)}
.hero{padding:72px 0 48px}
`,
      },
      { path: 'script.js', content: MOBILE_NAV_JS },
    ],
  },
  {
    slug: 'digital-agency',
    name: 'Digital Agency',
    description:
      'A reusable client-facing site for digital agencies, covering services, process, and client results.',
    kind: 'FULL_TEMPLATE',
    market: 'AGENCY',
    sortOrder: 3,
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Forge Digital — We Build Products That Grow</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="container">
    <nav class="site-nav">
      <span class="logo">Forge Digital</span>
      <ul>
        <li><a href="#services">Services</a></li>
        <li><a href="#process">Process</a></li>
        <li><a href="#work">Work</a></li>
        <li><a href="#contact">Contact</a></li>
      </ul>
    </nav>
  </header>

  <section class="hero container">
    <h1>We build digital products that grow your business.</h1>
    <p class="muted" style="margin-top:16px;max-width:560px">A full-service digital agency specializing in web design, branding, and development for ambitious teams.</p>
    <div style="margin-top:28px;display:flex;gap:16px">
      <a class="btn btn-primary" href="#contact">Start a project</a>
      <a class="btn btn-secondary" href="#work">View our work</a>
    </div>
  </section>

  <section id="services" class="container">
    <h2>What we do</h2>
    <div class="grid grid-3">
      <div class="card"><h3>Web Design</h3><p class="muted" style="margin-top:8px">Modern, conversion-focused websites built for your brand.</p></div>
      <div class="card"><h3>Branding</h3><p class="muted" style="margin-top:8px">Logos, visual identity, and brand guidelines that stand out.</p></div>
      <div class="card"><h3>Development</h3><p class="muted" style="margin-top:8px">Fast, reliable builds from landing pages to full web apps.</p></div>
    </div>
  </section>

  <section id="process" class="container">
    <h2>How we work</h2>
    <div class="grid grid-3">
      <div class="card"><h3>1. Discover</h3><p class="muted" style="margin-top:8px">We learn your goals, audience, and competitors.</p></div>
      <div class="card"><h3>2. Design &amp; Build</h3><p class="muted" style="margin-top:8px">We design, get your feedback, then build it for real.</p></div>
      <div class="card"><h3>3. Launch &amp; Grow</h3><p class="muted" style="margin-top:8px">We ship, measure, and keep improving after launch.</p></div>
    </div>
  </section>

  <section id="work" class="container">
    <h2>Client results</h2>
    <div class="grid grid-3">
      <div class="card"><p>"Forge rebuilt our site in three weeks and signups doubled."</p><p class="muted" style="margin-top:12px">— Lena, Head of Growth at Hubbly</p></div>
      <div class="card"><p>"The best agency we've worked with — on time, on budget, great work."</p><p class="muted" style="margin-top:12px">— Theo, Founder at Ridgeline</p></div>
    </div>
  </section>

  <section id="contact" class="container">
    <h2>Start your project</h2>
    <p class="muted" style="margin-bottom:20px">Tell us about your project and we'll follow up within one business day.</p>
    <form class="contact-form" data-aw-form="contact">
      <input type="text" name="name" placeholder="Your name" required />
      <input type="email" name="email" placeholder="Work email" required />
      <input type="text" name="company" placeholder="Company" />
      <textarea rows="4" name="message" placeholder="What are you looking to build?"></textarea>
      <button class="btn btn-primary" type="submit">Send inquiry</button>
      <p class="form-note muted" data-aw-form-status></p>
    </form>
  </section>

  <footer class="site-footer container">
    <p>&copy; 2026 Forge Digital. Built with AppWeaver AI.</p>
  </footer>

  <script src="script.js"></script>
</body>
</html>
`,
      },
      {
        path: 'styles.css',
        content: `:root{--accent:#ea580c;--text:#1a1512;--muted:#5c5349;--surface:#ffffff;--border:#ece3da;--bg:#fbf8f5}
${BASE_RESET}
body{background:var(--bg)}
.hero{padding:72px 0 48px}
`,
      },
      { path: 'script.js', content: MOBILE_NAV_JS },
    ],
  },
  {
    slug: 'saas-landing',
    name: 'SaaS Landing Page',
    description:
      'A product landing page for software startups: features, pricing tiers, and a signup call to action.',
    kind: 'FULL_TEMPLATE',
    market: 'SAAS',
    sortOrder: 4,
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Flowbase — Project management that keeps up with you</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="container">
    <nav class="site-nav">
      <span class="logo">Flowbase</span>
      <ul>
        <li><a href="#features">Features</a></li>
        <li><a href="#pricing">Pricing</a></li>
        <li><a href="#testimonials">Customers</a></li>
        <li><a href="#signup">Sign up</a></li>
      </ul>
    </nav>
  </header>

  <section class="hero container">
    <h1>Project management that keeps up with your team.</h1>
    <p class="muted" style="margin-top:16px;max-width:560px">Flowbase brings tasks, docs, and conversations into one place, so nothing falls through the cracks.</p>
    <div style="margin-top:28px;display:flex;gap:16px">
      <a class="btn btn-primary" href="#signup">Start free trial</a>
      <a class="btn btn-secondary" href="#features">See features</a>
    </div>
  </section>

  <section id="features" class="container">
    <h2>Everything your team needs</h2>
    <div class="grid grid-3">
      <div class="card"><h3>Tasks &amp; Boards</h3><p class="muted" style="margin-top:8px">Organize work with boards, lists, and custom workflows.</p></div>
      <div class="card"><h3>Docs</h3><p class="muted" style="margin-top:8px">Keep specs and notes next to the work they describe.</p></div>
      <div class="card"><h3>Integrations</h3><p class="muted" style="margin-top:8px">Connect the tools your team already uses, in minutes.</p></div>
    </div>
  </section>

  <section id="pricing" class="container">
    <h2>Simple, transparent pricing</h2>
    <div class="grid grid-3">
      <div class="card"><h3>Starter</h3><p style="font-size:2rem;font-weight:800;margin:12px 0">$0</p><p class="muted">For individuals getting started.</p></div>
      <div class="card" style="border-color:var(--accent)"><h3>Team</h3><p style="font-size:2rem;font-weight:800;margin:12px 0">$12<span class="muted" style="font-size:1rem">/user/mo</span></p><p class="muted">For growing teams that need more power.</p></div>
      <div class="card"><h3>Business</h3><p style="font-size:2rem;font-weight:800;margin:12px 0">$29<span class="muted" style="font-size:1rem">/user/mo</span></p><p class="muted">Advanced controls for larger organizations.</p></div>
    </div>
  </section>

  <section id="testimonials" class="container">
    <h2>Loved by teams everywhere</h2>
    <div class="grid grid-3">
      <div class="card"><p>"Flowbase replaced three different tools for us."</p><p class="muted" style="margin-top:12px">— Alicia, Ops Lead</p></div>
      <div class="card"><p>"Our team finally has one place to track everything."</p><p class="muted" style="margin-top:12px">— Marcus, Engineering Manager</p></div>
    </div>
  </section>

  <section id="signup" class="container">
    <h2>Start your free trial</h2>
    <p class="muted" style="margin-bottom:20px">No credit card required. Cancel anytime.</p>
    <form class="contact-form" data-aw-form="signup">
      <input type="email" name="email" placeholder="Work email" required />
      <button class="btn btn-primary" type="submit">Create account</button>
      <p class="form-note muted" data-aw-form-status></p>
    </form>
  </section>

  <footer class="site-footer container">
    <p>&copy; 2026 Flowbase. Built with AppWeaver AI.</p>
  </footer>

  <script src="script.js"></script>
</body>
</html>
`,
      },
      {
        path: 'styles.css',
        content: `:root{--accent:#2563eb;--text:#111827;--muted:#56607a;--surface:#ffffff;--border:#e3e7f0;--bg:#f7f9fd}
${BASE_RESET}
body{background:var(--bg)}
.hero{padding:72px 0 48px}
`,
      },
      { path: 'script.js', content: MOBILE_NAV_JS },
    ],
  },

  // ---------------------------------------------------------------------
  // Reusable sections — each ships scoped <style>/<script> so it can be
  // appended into any artifact's index.html without a CSS/JS merge step.
  // ---------------------------------------------------------------------
  {
    slug: 'section-hero-centered',
    name: 'Centered Hero',
    description:
      'A centered headline, subheadline, and two call-to-action buttons.',
    kind: 'SECTION',
    market: 'GENERAL',
    sortOrder: 1,
    files: [
      {
        path: 'section.html',
        content: `<section class="tpl-section tpl-hero-centered">
  <style>
    .tpl-hero-centered{padding:80px 24px;text-align:center;background:#fafafc}
    .tpl-hero-centered .tpl-inner{max-width:640px;margin:0 auto}
    .tpl-hero-centered h2{font-size:clamp(1.75rem,4vw,2.75rem);font-weight:800;line-height:1.15}
    .tpl-hero-centered p{margin-top:16px;color:#5b5b6b;font-size:1.05rem}
    .tpl-hero-centered .tpl-actions{margin-top:28px;display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
    .tpl-hero-centered .tpl-btn{padding:12px 24px;border-radius:8px;font-weight:600;text-decoration:none}
    .tpl-hero-centered .tpl-btn-primary{background:#4f46e5;color:#fff}
    .tpl-hero-centered .tpl-btn-secondary{border:2px solid #4f46e5;color:#4f46e5}
  </style>
  <div class="tpl-inner">
    <h2>A clear headline that explains what you offer</h2>
    <p>A short supporting sentence that tells visitors why it matters and what to do next.</p>
    <div class="tpl-actions">
      <a class="tpl-btn tpl-btn-primary" href="#">Get started</a>
      <a class="tpl-btn tpl-btn-secondary" href="#">Learn more</a>
    </div>
  </div>
</section>
`,
      },
    ],
  },
  {
    slug: 'section-testimonials-grid',
    name: 'Testimonials Grid',
    description: 'Three customer quotes side by side.',
    kind: 'SECTION',
    market: 'GENERAL',
    sortOrder: 2,
    files: [
      {
        path: 'section.html',
        content: `<section class="tpl-section tpl-testimonials">
  <style>
    .tpl-testimonials{padding:64px 24px;background:#ffffff}
    .tpl-testimonials .tpl-inner{max-width:1100px;margin:0 auto}
    .tpl-testimonials h2{font-size:1.75rem;font-weight:700;margin-bottom:28px;text-align:center}
    .tpl-testimonials .tpl-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
    @media (max-width:820px){.tpl-testimonials .tpl-grid{grid-template-columns:1fr}}
    .tpl-testimonials .tpl-card{background:#f8f8fb;border:1px solid #e6e6ee;border-radius:12px;padding:24px}
    .tpl-testimonials .tpl-name{margin-top:14px;font-weight:600;color:#44445a}
  </style>
  <div class="tpl-inner">
    <h2>What our customers say</h2>
    <div class="tpl-grid">
      <div class="tpl-card"><p>"This completely changed how our team works."</p><p class="tpl-name">— Alex R.</p></div>
      <div class="tpl-card"><p>"Simple to use and genuinely saved us time."</p><p class="tpl-name">— Priya S.</p></div>
      <div class="tpl-card"><p>"Support is fast and the product just works."</p><p class="tpl-name">— Marcus T.</p></div>
    </div>
  </div>
</section>
`,
      },
    ],
  },
  {
    slug: 'section-pricing-three-tier',
    name: 'Pricing (3 tiers)',
    description: 'Three pricing cards with a highlighted recommended plan.',
    kind: 'SECTION',
    market: 'GENERAL',
    sortOrder: 3,
    files: [
      {
        path: 'section.html',
        content: `<section class="tpl-section tpl-pricing">
  <style>
    .tpl-pricing{padding:64px 24px;background:#fafafc}
    .tpl-pricing .tpl-inner{max-width:1100px;margin:0 auto}
    .tpl-pricing h2{font-size:1.75rem;font-weight:700;margin-bottom:28px;text-align:center}
    .tpl-pricing .tpl-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
    @media (max-width:820px){.tpl-pricing .tpl-grid{grid-template-columns:1fr}}
    .tpl-pricing .tpl-card{background:#fff;border:1px solid #e6e6ee;border-radius:12px;padding:28px;text-align:center}
    .tpl-pricing .tpl-card.tpl-featured{border-color:#4f46e5;box-shadow:0 0 0 2px #4f46e5 inset}
    .tpl-pricing .tpl-price{font-size:2rem;font-weight:800;margin:12px 0}
    .tpl-pricing .tpl-btn{display:inline-block;margin-top:16px;padding:10px 20px;border-radius:8px;background:#4f46e5;color:#fff;font-weight:600;text-decoration:none}
  </style>
  <div class="tpl-inner">
    <h2>Simple, transparent pricing</h2>
    <div class="tpl-grid">
      <div class="tpl-card"><h3>Basic</h3><p class="tpl-price">$9/mo</p><p>For individuals</p><a class="tpl-btn" href="#">Choose plan</a></div>
      <div class="tpl-card tpl-featured"><h3>Pro</h3><p class="tpl-price">$29/mo</p><p>For growing teams</p><a class="tpl-btn" href="#">Choose plan</a></div>
      <div class="tpl-card"><h3>Business</h3><p class="tpl-price">$79/mo</p><p>For larger organizations</p><a class="tpl-btn" href="#">Choose plan</a></div>
    </div>
  </div>
</section>
`,
      },
    ],
  },
  {
    slug: 'section-footer-simple',
    name: 'Simple Footer',
    description: 'A footer with link columns and social icons placeholder.',
    kind: 'SECTION',
    market: 'GENERAL',
    sortOrder: 4,
    files: [
      {
        path: 'section.html',
        content: `<section class="tpl-section tpl-footer-simple">
  <style>
    .tpl-footer-simple{padding:48px 24px 28px;background:#17171f;color:#d0d0da}
    .tpl-footer-simple .tpl-inner{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr;gap:24px}
    @media (max-width:720px){.tpl-footer-simple .tpl-inner{grid-template-columns:1fr}}
    .tpl-footer-simple h4{color:#fff;margin-bottom:10px;font-size:.95rem}
    .tpl-footer-simple ul{display:flex;flex-direction:column;gap:8px}
    .tpl-footer-simple a{color:#d0d0da;text-decoration:none;font-size:.9rem}
    .tpl-footer-simple .tpl-bottom{max-width:1100px;margin:28px auto 0;border-top:1px solid #33333f;padding-top:16px;font-size:.85rem;color:#9a9aa8}
  </style>
  <div class="tpl-inner">
    <div><h4>Your Company</h4><p style="font-size:.9rem">Building better products for your customers.</p></div>
    <div><h4>Company</h4><ul><li><a href="#">About</a></li><li><a href="#">Careers</a></li><li><a href="#">Contact</a></li></ul></div>
    <div><h4>Follow</h4><ul><li><a href="#">Twitter</a></li><li><a href="#">LinkedIn</a></li><li><a href="#">Instagram</a></li></ul></div>
  </div>
  <p class="tpl-bottom">&copy; 2026 Your Company. All rights reserved.</p>
</section>
`,
      },
    ],
  },
  {
    slug: 'section-contact-form',
    name: 'Contact Form',
    description: 'A contact section with a name/email/message form.',
    kind: 'SECTION',
    market: 'GENERAL',
    sortOrder: 5,
    files: [
      {
        path: 'section.html',
        content: `<section class="tpl-section tpl-contact">
  <style>
    .tpl-contact{padding:64px 24px;background:#ffffff}
    .tpl-contact .tpl-inner{max-width:520px;margin:0 auto}
    .tpl-contact h2{font-size:1.75rem;font-weight:700;margin-bottom:12px;text-align:center}
    .tpl-contact p{text-align:center;color:#5b5b6b;margin-bottom:24px}
    .tpl-contact form{display:flex;flex-direction:column;gap:14px}
    .tpl-contact input,.tpl-contact textarea{padding:12px 14px;border-radius:8px;border:1px solid #dcdce6;font:inherit}
    .tpl-contact button{padding:12px 24px;border-radius:8px;background:#4f46e5;color:#fff;font-weight:600;border:none;cursor:pointer}
    .tpl-contact .tpl-note{text-align:center;font-size:.9rem;color:#5b5b6b;min-height:1.2em}
    .tpl-contact .tpl-note.aw-form-error{color:#dc2626}
  </style>
  <div class="tpl-inner">
    <h2>Get in touch</h2>
    <p>Have a question? Send us a message and we'll respond within one business day.</p>
    <form class="tpl-contact-form" data-aw-form="contact">
      <input type="text" name="name" placeholder="Your name" required />
      <input type="email" name="email" placeholder="Your email" required />
      <textarea rows="4" name="message" placeholder="Your message"></textarea>
      <button type="submit">Send message</button>
      <p class="tpl-note" data-aw-form-status></p>
    </form>
  </div>
  <script>
    (function(){
      // Fallback for environments where the editor's generic form-submit
      // shim never attaches (e.g. downloaded/exported HTML with no
      // <base href> project id to post to): after giving the shim a brief
      // moment to attach (it sets data-aw-handled on the form), fall back to
      // the old no-op "thanks" message so the form still feels responsive.
      var form = document.currentScript.closest('section').querySelector('.tpl-contact-form');
      if (!form) return;
      setTimeout(function () {
        if (form.hasAttribute('data-aw-handled')) return;
        form.setAttribute('data-aw-handled', 'true');
        form.addEventListener('submit', function (event) {
          event.preventDefault();
          var note = form.querySelector('.tpl-note');
          if (note) note.textContent = "Thanks! We'll be in touch soon.";
          form.reset();
        });
      }, 300);
    })();
  </script>
</section>
`,
      },
    ],
  },
  {
    slug: 'section-faq',
    name: 'FAQ',
    description: 'Expandable frequently asked questions.',
    kind: 'SECTION',
    market: 'GENERAL',
    sortOrder: 6,
    files: [
      {
        path: 'section.html',
        content: `<section class="tpl-section tpl-faq">
  <style>
    .tpl-faq{padding:64px 24px;background:#f7f7fb}
    .tpl-faq .tpl-inner{max-width:720px;margin:0 auto}
    .tpl-faq h2{font-size:1.75rem;font-weight:700;margin-bottom:24px;text-align:center}
    .tpl-faq details{background:#fff;border:1px solid #e3e3ee;border-radius:10px;padding:16px 20px;margin-bottom:12px}
    .tpl-faq summary{font-weight:600;cursor:pointer}
    .tpl-faq details p{margin-top:10px;color:#5b5b6b}
  </style>
  <div class="tpl-inner">
    <h2>Frequently asked questions</h2>
    <details><summary>How does it work?</summary><p>Explain your process in a sentence or two.</p></details>
    <details><summary>How much does it cost?</summary><p>Describe your pricing or point to your pricing section.</p></details>
    <details><summary>How can I get support?</summary><p>Tell visitors how to reach you.</p></details>
  </div>
</section>
`,
      },
    ],
  },
  {
    slug: 'section-features-grid',
    name: 'Features Grid',
    description: 'Three feature cards with headings and short descriptions.',
    kind: 'SECTION',
    market: 'GENERAL',
    sortOrder: 7,
    files: [
      {
        path: 'section.html',
        content: `<section class="tpl-section tpl-features">
  <style>
    .tpl-features{padding:64px 24px;background:#fff}
    .tpl-features .tpl-inner{max-width:1100px;margin:0 auto}
    .tpl-features h2{font-size:1.75rem;font-weight:700;margin-bottom:32px;text-align:center}
    .tpl-features .tpl-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
    @media (max-width:860px){.tpl-features .tpl-grid{grid-template-columns:1fr}}
    .tpl-features .tpl-card{border:1px solid #e3e3ee;border-radius:12px;padding:24px}
    .tpl-features h3{margin-bottom:8px;font-size:1.1rem}
    .tpl-features p{color:#5b5b6b}
  </style>
  <div class="tpl-inner">
    <h2>Why choose us</h2>
    <div class="tpl-grid">
      <div class="tpl-card"><h3>Fast</h3><p>Describe a key benefit that sets you apart.</p></div>
      <div class="tpl-card"><h3>Reliable</h3><p>Describe another benefit your customers care about.</p></div>
      <div class="tpl-card"><h3>Friendly</h3><p>Describe the experience customers can expect.</p></div>
    </div>
  </div>
</section>
`,
      },
    ],
  },
  {
    slug: 'section-cta-banner',
    name: 'Call-to-Action Banner',
    description: 'A bold banner with a headline and a button.',
    kind: 'SECTION',
    market: 'GENERAL',
    sortOrder: 8,
    files: [
      {
        path: 'section.html',
        content: `<section class="tpl-section tpl-cta">
  <style>
    .tpl-cta{padding:56px 24px;background:#4f46e5;color:#fff;text-align:center}
    .tpl-cta h2{font-size:1.9rem;font-weight:800;margin-bottom:10px}
    .tpl-cta p{margin-bottom:22px;opacity:.9}
    .tpl-cta a{display:inline-block;padding:12px 28px;border-radius:8px;background:#fff;color:#4f46e5;font-weight:700;text-decoration:none}
  </style>
  <h2>Ready to get started?</h2>
  <p>Join today and see the difference.</p>
  <a href="#contact">Get started</a>
</section>
`,
      },
    ],
  },
  {
    slug: 'section-team',
    name: 'Team',
    description: 'Introduce three team members.',
    kind: 'SECTION',
    market: 'GENERAL',
    sortOrder: 9,
    files: [
      {
        path: 'section.html',
        content: `<section class="tpl-section tpl-team">
  <style>
    .tpl-team{padding:64px 24px;background:#f7f7fb}
    .tpl-team .tpl-inner{max-width:1000px;margin:0 auto}
    .tpl-team h2{font-size:1.75rem;font-weight:700;margin-bottom:32px;text-align:center}
    .tpl-team .tpl-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;text-align:center}
    @media (max-width:760px){.tpl-team .tpl-grid{grid-template-columns:1fr}}
    .tpl-team .tpl-avatar{width:88px;height:88px;border-radius:50%;background:#c7c7e8;margin:0 auto 12px}
    .tpl-team p{color:#5b5b6b;font-size:.9rem}
  </style>
  <div class="tpl-inner">
    <h2>Meet the team</h2>
    <div class="tpl-grid">
      <div><div class="tpl-avatar"></div><h3>Alex Morgan</h3><p>Founder</p></div>
      <div><div class="tpl-avatar"></div><h3>Sam Lee</h3><p>Design lead</p></div>
      <div><div class="tpl-avatar"></div><h3>Jordan Cruz</h3><p>Customer success</p></div>
    </div>
  </div>
</section>
`,
      },
    ],
  },
];

const allTemplates = [
  ...templates,
  ...EXTRA_SITES.map((config) => buildSite(config, BASE_RESET, MOBILE_NAV_JS)),
  ...EXTRA_SECTIONS,
];

async function main() {
  for (const template of allTemplates) {
    const record = await prisma.websiteTemplate.upsert({
      where: { slug: template.slug },
      create: {
        slug: template.slug,
        name: template.name,
        description: template.description,
        kind: template.kind,
        market: template.market,
        sortOrder: template.sortOrder,
        isPublished: true,
      },
      update: {
        name: template.name,
        description: template.description,
        kind: template.kind,
        market: template.market,
        sortOrder: template.sortOrder,
        isPublished: true,
      },
    });

    await prisma.websiteTemplateFile.deleteMany({
      where: { templateId: record.id },
    });
    await prisma.websiteTemplateFile.createMany({
      data: template.files.map((file) => ({
        templateId: record.id,
        path: file.path,
        content: file.content,
      })),
    });

    console.log(`Seeded ${template.kind === 'SECTION' ? 'section' : 'template'}: ${template.name}`);
  }
}

main()
  .then(() => {
    console.log(`Done. Seeded ${templates.length} templates/sections.`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
