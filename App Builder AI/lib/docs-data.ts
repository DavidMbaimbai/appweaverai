export type DocsSection = {
  heading: string;
  body: string[];
};

export type DocsArticle = {
  slug: string;
  title: string;
  summary: string;
  category: string;
  sections: DocsSection[];
};

export type DocsCategory = {
  id: string;
  title: string;
};

export const docsCategories: DocsCategory[] = [
  { id: 'getting-started', title: 'Getting Started' },
  { id: 'agent', title: 'Building with the Agent' },
  { id: 'workspace', title: 'Workspace & Editor' },
  { id: 'data', title: 'Databases & Storage' },
  { id: 'deploy', title: 'Publishing & Domains' },
  { id: 'teams', title: 'Collaboration & Teams' },
  { id: 'account', title: 'Billing & Account' },
  { id: 'support', title: 'Troubleshooting & Support' },
];

export const docsArticles: DocsArticle[] = [
  {
    slug: 'welcome',
    title: 'Welcome to AppWeaver AI',
    summary:
      'What AppWeaver AI is, who it is for, and how the pieces fit together.',
    category: 'getting-started',
    sections: [
      {
        heading: 'What is AppWeaver AI?',
        body: [
          'AppWeaver AI is a platform for describing an app in plain language and having the Agent build, run, and host it for you. You can start from a blank prompt, a Figma import, or an existing GitHub repository, and keep shaping the result with more prompts, direct edits, or both.',
          'The same account gives you a code editor, a built-in database, a place to preview your app as it changes, and a one-click way to publish it to a public URL.',
        ],
      },
      {
        heading: 'Who uses it',
        body: [
          'Builders at every level use AppWeaver AI: people validating an idea for the first time, product teams shipping internal tools, and professional developers who want the Agent to handle boilerplate so they can focus on the interesting parts.',
        ],
      },
      {
        heading: 'Where to go next',
        body: [
          'If this is your first project, start with "Your first project" in this section. If you already have an app in mind, jump straight to "Prompting the Agent effectively".',
        ],
      },
    ],
  },
  {
    slug: 'first-project',
    title: 'Your first project',
    summary: 'Create, preview, and iterate on your first app in a few minutes.',
    category: 'getting-started',
    sections: [
      {
        heading: 'Start from a prompt',
        body: [
          'From the homepage, describe what you want to build in a sentence or two — for example, "a habit tracker with daily streaks and a weekly summary." The Agent proposes a plan, then starts scaffolding the project.',
        ],
      },
      {
        heading: 'Watch it build',
        body: [
          'As the Agent works, you will see files being created and a live preview updating on the right. You can pause at any point to ask a question or redirect the approach before it continues.',
        ],
      },
      {
        heading: 'Iterate with follow-up prompts',
        body: [
          'Once the first version is ready, keep refining it with more prompts ("make the streak counter bigger", "add a dark mode toggle"), or open the file tree and edit code directly — both are always available side by side.',
        ],
      },
    ],
  },
  {
    slug: 'importing-projects',
    title: 'Importing an existing project',
    summary: 'Bring in code from GitHub or a design file instead of starting blank.',
    category: 'getting-started',
    sections: [
      {
        heading: 'Import from GitHub',
        body: [
          'Connect a GitHub account from your workspace settings, then choose a repository to import. AppWeaver AI clones the repo, detects the framework, and sets up a working preview so the Agent can start making changes right away.',
        ],
      },
      {
        heading: 'Import a design',
        body: [
          'You can also start from a design file. The Agent reads the layout, spacing, and components, and turns it into working front-end code you can keep refining with prompts.',
        ],
      },
    ],
  },
  {
    slug: 'agent-overview',
    title: 'How the Agent works',
    summary: 'What happens between sending a prompt and seeing a working app.',
    category: 'agent',
    sections: [
      {
        heading: 'Plan, then build',
        body: [
          'For anything beyond a small tweak, the Agent first drafts a short plan — the files it expects to touch and the steps it will take — so you can confirm the direction before it starts writing code.',
        ],
      },
      {
        heading: 'Checkpoints',
        body: [
          'Work is saved in checkpoints as the Agent progresses. If a change is not what you wanted, you can roll back to any earlier checkpoint without losing the rest of your project.',
        ],
      },
      {
        heading: 'Self-checking',
        body: [
          'Before handing control back to you, the Agent reviews its own output for obvious errors — broken imports, failing builds, or console errors in the preview — and fixes what it can before reporting back.',
        ],
      },
    ],
  },
  {
    slug: 'prompting-guide',
    title: 'Prompting the Agent effectively',
    summary: 'Practical tips for getting better results out of your prompts.',
    category: 'agent',
    sections: [
      {
        heading: 'Be specific about the outcome',
        body: [
          'Prompts that describe the outcome ("a pricing page with three tiers and a monthly/yearly toggle") work better than prompts that describe implementation details you are not sure about.',
        ],
      },
      {
        heading: 'Work in small steps',
        body: [
          'For larger features, it helps to break the work into a few prompts rather than one giant request — this gives you more checkpoints to review and course-correct from.',
        ],
      },
      {
        heading: 'Use Plan mode for big changes',
        body: [
          'Plan mode has the Agent lay out its approach in detail before touching any files, which is useful before a large refactor or a change that touches many parts of the app.',
        ],
      },
    ],
  },
  {
    slug: 'parallel-agents',
    title: 'Working with parallel agents',
    summary: 'Run more than one Agent session on different parts of your app.',
    category: 'agent',
    sections: [
      {
        heading: 'Why run agents in parallel',
        body: [
          'On Core and Pro plans, you can open more than one Agent session against the same project — for example, one working on the front-end while another wires up a new API route — so independent pieces of work move forward at the same time.',
        ],
      },
      {
        heading: 'Avoiding conflicts',
        body: [
          'Each session works against its own checkpoint, and changes are merged as sessions complete. For best results, point parallel sessions at different areas of the codebase rather than the same files.',
        ],
      },
    ],
  },
  {
    slug: 'editor-basics',
    title: 'The editor and file tree',
    summary: 'Navigating your project structure and making manual edits.',
    category: 'workspace',
    sections: [
      {
        heading: 'File tree',
        body: [
          'The file tree on the left mirrors your project structure exactly, so anything the Agent creates is immediately visible and editable by hand.',
        ],
      },
      {
        heading: 'Editing directly',
        body: [
          'You are never limited to prompting — open any file and edit it like a normal code editor, with syntax highlighting and autocomplete. The Agent picks up manual edits the next time you prompt it.',
        ],
      },
    ],
  },
  {
    slug: 'preview-and-console',
    title: 'Preview, logs, and the console',
    summary: 'Seeing your app run and debugging issues as they come up.',
    category: 'workspace',
    sections: [
      {
        heading: 'Live preview',
        body: [
          'The preview pane reflects your app as it runs, refreshing automatically as files change. You can resize it, open it in a new tab, or switch to a mobile viewport to check responsiveness.',
        ],
      },
      {
        heading: 'Reading logs',
        body: [
          'Server and build logs appear in the console panel. When something fails, the Agent reads the same logs you see, which is why pasting an error message back to it usually gets a fast fix.',
        ],
      },
    ],
  },
  {
    slug: 'secrets-and-env',
    title: 'Environment variables & secrets',
    summary: 'Storing API keys and configuration safely.',
    category: 'workspace',
    sections: [
      {
        heading: 'Adding a secret',
        body: [
          'Secrets are added from the workspace Secrets panel, not written into your code. The Agent can reference a secret by name without ever seeing its value.',
        ],
      },
      {
        heading: 'Where secrets are available',
        body: [
          'Secrets are injected into your app at runtime and are available to server-side code. They are not bundled into anything shipped to the browser.',
        ],
      },
    ],
  },
  {
    slug: 'built-in-database',
    title: 'Using the built-in database',
    summary: 'Every project gets a database with no separate setup required.',
    category: 'data',
    sections: [
      {
        heading: 'Zero-config storage',
        body: [
          'Every project includes a managed database out of the box. You can ask the Agent to define tables and relationships in plain language, or open the schema view and edit it directly.',
        ],
      },
      {
        heading: 'Browsing data',
        body: [
          'The data explorer lets you view, filter, and edit rows without writing SQL, which is useful for checking that a feature is storing what you expect.',
        ],
      },
      {
        heading: 'Rollbacks',
        body: [
          'Paid plans support rolling the database back to an earlier point in time, which is helpful if a migration or bulk edit did not go as planned.',
        ],
      },
    ],
  },
  {
    slug: 'file-storage',
    title: 'File & object storage',
    summary: 'Storing uploads, images, and other files your app generates.',
    category: 'data',
    sections: [
      {
        heading: 'Object storage',
        body: [
          'For files that do not belong in a database row — images, exports, user uploads — projects can use built-in object storage, accessible from both the Agent and your own code.',
        ],
      },
    ],
  },
  {
    slug: 'publishing',
    title: 'Publishing your app',
    summary: 'Taking a project from preview to a live, public URL.',
    category: 'deploy',
    sections: [
      {
        heading: 'One-click publish',
        body: [
          'When you are ready, publishing takes a snapshot of your current app and puts it on its own always-on URL, separate from your in-progress preview.',
        ],
      },
      {
        heading: 'Redeploying',
        body: [
          'Publishing again after further changes updates the live version. Your published app keeps running on the previous version until the new one is ready, so visitors never see a broken state mid-deploy.',
        ],
      },
    ],
  },
  {
    slug: 'custom-domains',
    title: 'Custom domains',
    summary: 'Point your own domain name at a published project.',
    category: 'deploy',
    sections: [
      {
        heading: 'Connecting a domain',
        body: [
          'From your project\u2019s publish settings, add a domain you own and follow the DNS instructions shown there. Most domains are verified and serving traffic within a few minutes of the records propagating.',
        ],
      },
    ],
  },
  {
    slug: 'inviting-collaborators',
    title: 'Inviting collaborators',
    summary: 'Building an app together with teammates in real time.',
    category: 'teams',
    sections: [
      {
        heading: 'Adding people to a project',
        body: [
          'Invite collaborators by email from the workspace menu. Collaborators can prompt the Agent, edit files, and see the same live preview as you, all at the same time.',
        ],
      },
      {
        heading: 'Viewer access',
        body: [
          'Viewers can watch a project and its preview without being able to edit it — useful for stakeholders who want visibility without write access.',
        ],
      },
    ],
  },
  {
    slug: 'roles-and-permissions',
    title: 'Roles & permissions',
    summary: 'Owner, collaborator, and viewer access explained.',
    category: 'teams',
    sections: [
      {
        heading: 'Owner',
        body: ['The project owner controls billing, publishing, and who else has access.'],
      },
      {
        heading: 'Collaborator',
        body: ['Collaborators can prompt the Agent and edit code, but cannot change billing or remove the owner.'],
      },
      {
        heading: 'Viewer',
        body: ['Viewers can observe the project and preview in real time but cannot make changes.'],
      },
    ],
  },
  {
    slug: 'plans-and-credits',
    title: 'Plans & credits',
    summary: 'How usage-based credits work across Starter, Core, and Pro.',
    category: 'account',
    sections: [
      {
        heading: 'How credits are used',
        body: [
          'Agent usage is metered in credits, which scale with the complexity of a request and the model used. Starter includes a small free daily allowance; Core and Pro include a larger monthly credit balance.',
        ],
      },
      {
        heading: 'Changing plans',
        body: [
          'You can upgrade, downgrade, or cancel a plan at any time from account billing settings. Changes to paid plans take effect at the next billing cycle.',
        ],
      },
    ],
  },
  {
    slug: 'account-settings',
    title: 'Account settings',
    summary: 'Managing your profile, connected accounts, and notifications.',
    category: 'account',
    sections: [
      {
        heading: 'Profile & connected accounts',
        body: [
          'Update your display name, avatar, and connected sign-in providers from account settings. Connecting GitHub also enables project import and export.',
        ],
      },
    ],
  },
  {
    slug: 'troubleshooting',
    title: 'Troubleshooting common issues',
    summary: 'What to check when a build fails or the preview will not load.',
    category: 'support',
    sections: [
      {
        heading: 'Preview not loading',
        body: [
          'Check the console panel for a build error first — most blank previews are caused by a failed build rather than a networking issue. Paste the error into a prompt and the Agent will usually resolve it directly.',
        ],
      },
      {
        heading: 'Unexpected Agent output',
        body: [
          'If a change is not what you expected, roll back to the previous checkpoint and try a more specific prompt rather than continuing to build on top of the unwanted change.',
        ],
      },
    ],
  },
  {
    slug: 'getting-help',
    title: 'Getting help',
    summary: 'Where to go when documentation is not enough.',
    category: 'support',
    sections: [
      {
        heading: 'Community & support',
        body: [
          'For general questions, the Community hub is the fastest place to get an answer from other builders. For account or billing issues, reach out through the Help page and our support team will follow up by email.',
        ],
      },
      {
        heading: 'Reporting a bug',
        body: [
          'If you believe you have found a bug in the platform itself rather than in your own project, use the Report Abuse page or email support with steps to reproduce it.',
        ],
      },
    ],
  },
];

export function getDocsArticle(slug: string) {
  return docsArticles.find((article) => article.slug === slug);
}

export function getDocsArticlesByCategory(categoryId: string) {
  return docsArticles.filter((article) => article.category === categoryId);
}
