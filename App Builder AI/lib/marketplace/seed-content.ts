import { envVarsFor, INTEGRATIONS } from '@/lib/integrations/catalogue';

import type { Bundle } from './bundle';
import type { AssetType } from './types';

export type FirstPartyAsset = {
  slug: string;
  type: AssetType;
  title: string;
  summary: string;
  description: string;
  tags: string[];
  license: string;
  bundle: Bundle;
};

const LANDING_CSS = `:root { --accent: #ff6a1f; --ink: #1a1a1a; --muted: #5b5b66; --bg: #fbfaf8; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--ink); background: var(--bg); line-height: 1.55; }
header, section, footer { max-width: 960px; margin: 0 auto; padding: 48px 24px; }
nav { display: flex; justify-content: space-between; align-items: center; }
nav a { color: var(--ink); text-decoration: none; margin-left: 20px; }
.hero { text-align: center; padding-top: 80px; }
.hero h1 { font-size: clamp(2rem, 6vw, 3.5rem); line-height: 1.05; margin: 0 0 16px; }
.hero p { color: var(--muted); font-size: 1.15rem; max-width: 560px; margin: 0 auto 28px; }
.button { display: inline-block; background: var(--accent); color: #fff; padding: 12px 24px; border-radius: 999px; text-decoration: none; border: 0; font: inherit; cursor: pointer; }
.features { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.card { background: #fff; border: 1px solid #ececf0; border-radius: 14px; padding: 20px; }
.card h3 { margin-top: 0; }
form { display: grid; gap: 12px; max-width: 480px; }
input, textarea { font: inherit; padding: 10px 12px; border: 1px solid #d5d5dc; border-radius: 10px; width: 100%; }
[data-aw-form-status] { min-height: 1.4em; color: var(--muted); }
.aw-form-error { color: #b42318; }
footer { color: var(--muted); font-size: 0.9rem; text-align: center; }
`;

const CONTACT_FORM = (id: string) => `<form data-aw-form="contact" id="${id}">
  <label>Name<input name="name" type="text" required maxlength="120" autocomplete="name" /></label>
  <label>Email<input name="email" type="email" required maxlength="200" autocomplete="email" /></label>
  <label>Message<textarea name="message" rows="5" required maxlength="2000"></textarea></label>
  <button class="button" type="submit">Send message</button>
  <p data-aw-form-status role="status"></p>
</form>`;

const landingPage = (title: string, tagline: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${tagline}" />
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header>
    <nav>
      <strong>${title}</strong>
      <span><a href="#features">Features</a><a href="#contact">Contact</a></span>
    </nav>
  </header>
  <section class="hero">
    <h1>${tagline}</h1>
    <p>Replace this text with one sentence that says who the product is for and what it does for them.</p>
    <a class="button" href="#contact">Get in touch</a>
  </section>
  <section id="features">
    <div class="features">
      <div class="card"><h3>Feature one</h3><p>Describe the first benefit in plain language.</p></div>
      <div class="card"><h3>Feature two</h3><p>Describe the second benefit in plain language.</p></div>
      <div class="card"><h3>Feature three</h3><p>Describe the third benefit in plain language.</p></div>
    </div>
  </section>
  <section id="contact">
    <h2>Contact</h2>
    ${CONTACT_FORM('contact-form')}
  </section>
  <footer>&copy; ${title}. All rights reserved.</footer>
</body>
</html>
`;

const FORM_NOTE =
  'The form uses the data-aw-form attribute, so on AppWeaver previews and published sites submissions are captured by the platform form endpoint (visible in your project forms and leads). Exported HTML needs its own backend.';

function integrationAssets(): FirstPartyAsset[] {
  return INTEGRATIONS.filter((def) => def.status === 'available' && def.setup).map((def) => {
    const envVars = envVarsFor(def);
    const doc = [
      `# ${def.name} setup`,
      '',
      def.description,
      '',
      `Docs: ${def.docsUrl}`,
      '',
      envVars.length > 0 ? `## Environment variables (set automatically when you connect it)\n\n${envVars.map((v) => `- \`${v}\``).join('\n')}\n` : '',
      def.scopes.length > 0 ? `## Permissions the credential needs\n\n${def.scopes.map((s) => `- ${s}`).join('\n')}\n` : '',
      '## Server-side example',
      '',
      def.setup?.note ? `${def.setup.note}\n` : '',
      '```ts',
      def.setup?.snippet ?? '',
      '```',
      '',
      `Cost note: ${def.costNote}`,
      '',
    ]
      .filter((line) => line !== '')
      .join('\n');
    return {
      slug: `integration-${def.id}`,
      type: 'INTEGRATION' as const,
      title: `${def.name} setup guide`,
      summary: `Server-side example and checklist for connecting ${def.name}. Credentials are never included.`,
      description: `${def.description}\n\nThis asset adds a setup guide (and an integration descriptor) to your project. It links to the built-in ${def.name} connector, so you connect and test the credential in the project Integrations page; nothing here contains a secret.`,
      tags: ['integration', def.category.toLowerCase()],
      license: 'MIT',
      bundle: { schemaVersion: 1 as const, integrationId: def.id, files: [{ path: 'SETUP.md', content: doc }] },
    };
  });
}

/** First-party free assets, built from what this repository really provides. No ratings or counts are ever seeded. */
export function firstPartyAssets(): FirstPartyAsset[] {
  return [
    {
      slug: 'simple-landing-page',
      type: 'TEMPLATE',
      title: 'Simple landing page',
      summary: 'One-page responsive landing page with a hero, three feature cards and a working contact form.',
      description: `A dependency-free HTML and CSS landing page. Edit the copy, colours (CSS variables at the top of styles.css) and sections.\n\n${FORM_NOTE}`,
      tags: ['landing page', 'html', 'contact form'],
      license: 'MIT',
      bundle: {
        schemaVersion: 1,
        files: [
          { path: 'index.html', content: landingPage('Your product', 'A clear promise for your customers') },
          { path: 'styles.css', content: LANDING_CSS },
        ],
      },
    },
    {
      slug: 'contact-form-component',
      type: 'COMPONENT',
      title: 'Contact form component',
      summary: 'Accessible contact form markup and styles, wired to the platform form capture.',
      description: `Drop-in contact form with labels, validation attributes and a status line.\n\n${FORM_NOTE}`,
      tags: ['form', 'component', 'html'],
      license: 'MIT',
      bundle: {
        schemaVersion: 1,
        files: [
          { path: 'contact-form.html', content: `${CONTACT_FORM('contact-form')}\n` },
          {
            path: 'contact-form.css',
            content: `${LANDING_CSS.split('\n').filter((l) => /^(form|input|\[data-aw|\.aw-form|\.button)/.test(l)).join('\n')}\n`,
          },
        ],
      },
    },
    {
      slug: 'small-business-launch-kit',
      type: 'STARTER_KIT',
      title: 'Small business launch kit',
      summary: 'A three-page business site (home, services, contact) plus a launch checklist.',
      description: `Starter pages for a local or service business with a shared stylesheet and a LAUNCH_CHECKLIST.md that walks through the AppWeaver steps before going live.\n\n${FORM_NOTE}`,
      tags: ['business', 'starter kit', 'html'],
      license: 'MIT',
      bundle: {
        schemaVersion: 1,
        files: [
          { path: 'index.html', content: landingPage('Your business', 'Friendly local service you can rely on') },
          {
            path: 'services.html',
            content: `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>Services</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n  <header><nav><strong>Your business</strong><span><a href="index.html">Home</a></span></nav></header>\n  <section>\n    <h1>Services</h1>\n    <div class="features">\n      <div class="card"><h3>Service A</h3><p>What it is, who it is for and what it costs.</p></div>\n      <div class="card"><h3>Service B</h3><p>What it is, who it is for and what it costs.</p></div>\n    </div>\n  </section>\n</body>\n</html>\n`,
          },
          { path: 'styles.css', content: LANDING_CSS },
          {
            path: 'LAUNCH_CHECKLIST.md',
            content: `# Launch checklist\n\n1. Replace every placeholder sentence and add real contact details.\n2. Send yourself a test message through the contact form and confirm it arrives.\n3. Run the project quality scan and fix anything marked high or critical.\n4. Check the page on a phone-sized screen.\n5. Publish, then confirm the live URL loads.\n`,
          },
        ],
      },
    },
    {
      slug: 'pre-launch-review-workflow',
      type: 'WORKFLOW',
      title: 'Pre-launch review workflow',
      summary: 'A step-by-step review an AI agent or a person can follow before publishing a project.',
      description:
        'A structured list of review steps (content, forms, quality, mobile, publish). It installs as workflow.json in your project. Instructions are plain text for you or your agent to follow; they do not run on their own.',
      tags: ['workflow', 'launch', 'checklist'],
      license: 'MIT',
      bundle: {
        schemaVersion: 1,
        files: [],
        workflow: {
          name: 'Pre-launch review',
          description: 'Review a project end to end before it goes live.',
          steps: [
            { id: 'content', title: 'Check the copy', instruction: 'Read every page and replace placeholder text. Check names, prices and contact details.' },
            { id: 'forms', title: 'Test the forms', instruction: 'Submit each form once and confirm the submission shows up in the project forms inbox.' },
            { id: 'quality', title: 'Run the quality scan', instruction: 'Open the project Quality page, run a scan and fix or acknowledge every high or critical finding.' },
            { id: 'mobile', title: 'Check small screens', instruction: 'Open the preview at phone width and look for overflow, tiny text and unreachable buttons.' },
            { id: 'publish', title: 'Publish and verify', instruction: 'Publish the project, open the live URL and repeat the form test once on the live site.' },
          ],
        },
      },
    },
    ...integrationAssets(),
  ];
}
