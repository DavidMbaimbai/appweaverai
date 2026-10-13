import { parse } from 'node-html-parser';

export type PreflightIssue = {
  severity: 'error' | 'warning';
  message: string;
  file: string;
};

const EXTERNAL_HREF = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

function resolveRelative(fromFile: string, href: string) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return fromFile;

  const parts = clean.startsWith('/')
    ? []
    : fromFile.split('/').slice(0, -1);
  for (const seg of clean.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export type PreflightSeo = { title?: string | null; description?: string | null };

/**
 * Basic pre-publish checks for one HTML page (Flow 6, step 26).
 * `filePath` is relative to the artifact; `knownFiles` are all artifact-relative paths.
 * `seo` holds the project-level SEO settings, which fill in for the main page.
 */
export function checkHtmlPage(
  filePath: string,
  html: string,
  knownFiles: Set<string>,
  seo: PreflightSeo = {},
): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const add = (severity: PreflightIssue['severity'], message: string) =>
    issues.push({ severity, message, file: filePath });

  const root = parse(html, { blockTextElements: { script: false, style: false } });
  const body = root.querySelector('body') ?? root;
  const text = body.text.replace(/\s+/g, ' ').trim();
  const isMainPage = filePath === 'index.html';

  if (text.length < 20) add('error', 'The page has almost no visible content.');

  const pageTitle =
    root.querySelector('title')?.text.trim() ||
    (isMainPage ? seo.title?.trim() : '') ||
    '';
  if (!pageTitle) {
    add('warning', 'The page has no title.');
  } else if (pageTitle.length > 60) {
    add('warning', 'The page title is over 60 characters and may be cut off in search results.');
  }

  const description =
    root
      .querySelector('meta[name="description"]')
      ?.getAttribute('content')
      ?.trim() ||
    (isMainPage ? seo.description?.trim() : '') ||
    '';
  if (!description) {
    add('warning', 'The page has no meta description. Add one in SEO settings.');
  } else if (description.length > 160) {
    add('warning', 'The meta description is over 160 characters and may be cut off in search results.');
  }

  const h1Count = root.querySelectorAll('h1').length;
  if (!root.querySelector('h1')?.text.trim()) {
    add('warning', 'The page has no main heading (h1).');
  } else if (h1Count > 1) {
    add('warning', `The page has ${h1Count} main headings (h1). Use one per page.`);
  }
  if (/lorem ipsum/i.test(text)) {
    add('warning', 'Placeholder "Lorem ipsum" text is still on the page.');
  }

  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src')?.trim();
    if (img.getAttribute('alt') === undefined) {
      add('warning', `Image is missing alt text: ${src ?? 'no source'}`);
    }
    if (!src) {
      add('error', 'An image has no source.');
    } else if (!EXTERNAL_HREF.test(src) && !src.startsWith('data:')) {
      if (!knownFiles.has(resolveRelative(filePath, src))) {
        add('error', `Image file not found: ${src}`);
      }
    }
  }

  const ids = new Set(
    root.querySelectorAll('[id]').map((el) => el.getAttribute('id') ?? ''),
  );
  const reported = new Set<string>();

  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href')?.trim();
    const label = a.text.trim().slice(0, 30) || 'a link';
    let problem: string | null = null;
    let severity: PreflightIssue['severity'] = 'error';

    if (href === undefined || href === '' || href === '#') {
      problem = `"${label}" has no destination.`;
      severity = 'warning';
    } else if (href.startsWith('#')) {
      if (!ids.has(href.slice(1))) problem = `"${label}" points to missing section ${href}.`;
    } else if (!EXTERNAL_HREF.test(href)) {
      const target = resolveRelative(filePath, href);
      const hash = href.split('#')[1];
      const indexFile = target ? `${target}/index.html` : 'index.html';
      if (!knownFiles.has(target) && !knownFiles.has(indexFile)) {
        problem = `"${label}" links to a page that does not exist: ${href}`;
      } else if (hash && target === filePath && !ids.has(hash)) {
        problem = `"${label}" points to missing section #${hash}.`;
      }
    }

    if (problem && !reported.has(problem)) {
      reported.add(problem);
      add(severity, problem);
    }
  }

  return issues;
}
