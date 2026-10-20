import { isTestPath, type RawFinding, type ScanFile } from './types';

const JS_FILE = /\.(m?jsx?|tsx?|vue|svelte)$/i;
const HTML_FILE = /\.html?$/i;
const PY_FILE = /\.py$/i;
const API_ROUTE = /(^|\/)(app\/api\/.+\/route|pages\/api\/.+|api\/.+|server\/routes\/.+|routes\/.+)\.(m?[jt]s|tsx?)$/i;

type LineRule = {
  rule: string;
  severity: RawFinding['severity'];
  title: string;
  message: string;
  files: RegExp[];
  test: (line: string, ctx: { content: string; index: number; lines: string[] }) => boolean;
};

const STRING_ONLY = /^\s*(["'`])(?:(?!\1)[^\\$]|\\.)*\1\s*$/;
const SANITIZED = /sanitize|purify|escapeHtml|escape\(|encodeURI|DOMPurify|xss\(/i;
const SQL_START = /\b(?:select\s+[\s\S]+?\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i;

function dynamicHtmlAssignment(line: string) {
  const m = line.match(/\.(?:inner|outer)HTML\s*\+?=\s*(.+?);?\s*$/);
  if (!m) return false;
  const rhs = m[1];
  if (STRING_ONLY.test(rhs) || /^\s*(["'`])\1\s*$/.test(rhs)) return false;
  if (/^`[^`$]*`$/.test(rhs.trim())) return false;
  if (SANITIZED.test(rhs)) return false;
  return /\$\{|\+|[A-Za-z_$][\w$.]*\s*$/.test(rhs);
}

const RULES: LineRule[] = [
  {
    rule: 'code/eval',
    severity: 'HIGH',
    title: 'Use of eval()',
    message: 'eval() executes arbitrary text as code, so any attacker-controlled string becomes remote code execution. Parse data with JSON.parse or use explicit logic.',
    files: [JS_FILE, HTML_FILE],
    test: (line) => /(?<![\w$.])eval\s*\(/.test(line),
  },
  {
    rule: 'code/new-function',
    severity: 'HIGH',
    title: 'Code built with new Function()',
    message: 'new Function() compiles a string into code, which is as dangerous as eval(). Replace it with a normal function or a lookup table.',
    files: [JS_FILE, HTML_FILE],
    test: (line) => /\bnew\s+Function\s*\(/.test(line),
  },
  {
    rule: 'code/string-timer',
    severity: 'MEDIUM',
    title: 'String passed to setTimeout/setInterval',
    message: 'A string argument is evaluated like eval(). Pass a function instead.',
    files: [JS_FILE, HTML_FILE],
    test: (line) => /\bset(?:Timeout|Interval)\s*\(\s*["'`]/.test(line),
  },
  {
    rule: 'code/dangerously-set-inner-html',
    severity: 'HIGH',
    title: 'dangerouslySetInnerHTML with dynamic data',
    message: 'Rendering a variable as raw HTML allows cross-site scripting. Render text normally, or sanitise the HTML with a vetted library (for example DOMPurify) first.',
    files: [JS_FILE],
    test: (line, ctx) => {
      const nearby = ctx.lines.slice(Math.max(0, ctx.index - 2), ctx.index + 1).join(' ');
      if (!/dangerouslySetInnerHTML/.test(nearby)) return false;
      const m = line.match(/__html\s*:\s*(.+?)\s*(?:\}\s*\}|\}|,|$)/);
      if (!m) return false;
      const expr = m[1].trim();
      if (STRING_ONLY.test(expr)) return false;
      if (/^`[^`$]*`$/.test(expr)) return false;
      return !SANITIZED.test(expr);
    },
  },
  {
    rule: 'code/inner-html',
    severity: 'MEDIUM',
    title: 'innerHTML set from dynamic data',
    message: 'Assigning a variable or template to innerHTML allows cross-site scripting. Use textContent, or sanitise the HTML first.',
    files: [JS_FILE, HTML_FILE],
    test: (line) => dynamicHtmlAssignment(line),
  },
  {
    rule: 'code/document-write',
    severity: 'MEDIUM',
    title: 'document.write with dynamic data',
    message: 'document.write with a variable can inject scripts. Build elements with the DOM API instead.',
    files: [JS_FILE, HTML_FILE],
    test: (line) => {
      const m = line.match(/document\.write(?:ln)?\s*\((.*)\)/);
      return Boolean(m && !STRING_ONLY.test(m[1]) && !SANITIZED.test(m[1]));
    },
  },
  {
    rule: 'code/sql-concatenation',
    severity: 'HIGH',
    title: 'SQL built by string concatenation',
    message: 'Interpolating values into SQL allows SQL injection. Use parameterised queries (placeholders) or a query builder/ORM.',
    files: [JS_FILE, PY_FILE],
    test: (line) => {
      if (!SQL_START.test(line)) return false;
      const concatenated = /["'`]\s*\+\s*[A-Za-z_$(]|[A-Za-z_$)\]]\s*\+\s*["'`]/.test(line);
      // Untagged template literals only: tagged ones (sql`...`, prisma.$queryRaw`...`) are parameterised.
      const interpolatedTemplate = /(?<![\w$])`[^`]*\$\{[^`]*`/.test(line) && SQL_START.test(line.replace(/^[^`]*`/, ''));
      const pyFormat = /(?:["']\s*%\s*[\w(]|\.format\(|\bf["'][^"']*\{[^}]+\})/.test(line);
      return concatenated || interpolatedTemplate || pyFormat;
    },
  },
  {
    rule: 'code/command-injection',
    severity: 'HIGH',
    title: 'Shell command built from dynamic data',
    message: 'Passing interpolated strings to a shell lets input run arbitrary commands. Use execFile/spawn with an argument array and no shell, and validate inputs.',
    files: [JS_FILE, PY_FILE],
    test: (line) => {
      const js = /(?<![\w$])(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+|[A-Za-z_$][\w$.]*\s*[,)])/.test(line) && !/\.exec\(/.test(line.replace(/child_process\.exec/, ''));
      const jsShell = /\bshell\s*:\s*true\b/.test(line) && /(?:spawn|execFile)/.test(line);
      const py = /\bos\.(?:system|popen)\s*\(\s*(?:f["']|["'][^"']*["']\s*[+%]|[A-Za-z_])|subprocess\.\w+\([^)]*shell\s*=\s*True/.test(line);
      return js || jsShell || py;
    },
  },
  {
    rule: 'code/open-redirect',
    severity: 'MEDIUM',
    title: 'Redirect to an unvalidated user-supplied URL',
    message: 'Redirecting to a URL taken from the request lets attackers send users to phishing sites. Only redirect to relative paths or an allow-list of hosts.',
    files: [JS_FILE],
    test: (line) =>
      /(?:redirect|location\.(?:href|assign|replace))\s*(?:=|\()\s*[^;]*(?:req(?:uest)?\.(?:query|body|params)|searchParams\.get|URLSearchParams|params\.get|location\.(?:search|hash))/i.test(line) &&
      !/startsWith\(['"`]\/(?!\/)|allow|whitelist|isSafe|validate/i.test(line),
  },
  {
    rule: 'code/tls-verification-disabled',
    severity: 'HIGH',
    title: 'TLS certificate verification disabled',
    message: 'Disabling certificate verification exposes connections to interception. Remove it and trust the proper certificate authority instead.',
    files: [JS_FILE, PY_FILE],
    test: (line) =>
      /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED['"]?\s*(?:\]\s*)?=\s*['"]?0|verify\s*=\s*False/.test(line),
  },
  {
    rule: 'code/hardcoded-password',
    severity: 'HIGH',
    title: 'Hard-coded password',
    message: 'A password is written into the code. Anyone with the files (or the browser) can read it. Use environment variables or hashed credentials in a database.',
    files: [JS_FILE, HTML_FILE, PY_FILE],
    test: (line) => {
      const m = line.match(/(?<![\w-])(?:[\w]*[_-])?(?:password|passwd|pwd)["']?\s*[:=]\s*["'`]([^"'`\s]{4,})["'`]/i);
      if (!m) return false;
      const value = m[1];
      if (/^(password|passwd|pwd|text|\*+|•+|required|true|false)$/i.test(value)) return false;
      if (/example|your|xxxx|placeholder|changeme|\$\{|<|process\.env|\{\{/i.test(value)) return false;
      return true;
    },
  },
  {
    rule: 'code/insecure-http-request',
    severity: 'MEDIUM',
    title: 'Insecure http:// request or resource',
    message: 'This resource is loaded over plain HTTP, so it can be read or altered in transit and is blocked as mixed content on HTTPS sites. Use https://.',
    files: [JS_FILE, HTML_FILE],
    test: (line) =>
      /(?:fetch\s*\(|axios(?:\.\w+)?\s*\(|XMLHttpRequest|\.open\s*\(\s*["'][A-Z]+["']\s*,|<script[^>]+src=|<form[^>]+action=|<link[^>]+href=|<iframe[^>]+src=|<img[^>]+src=)\s*[^)]*["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|www\.w3\.org|schemas\.)/i.test(line),
  },
];

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#|<!--)/;

function applicable(rule: LineRule, path: string) {
  return rule.files.some((re) => re.test(path));
}

function hasAuthMarker(content: string) {
  return /getSession|getServerSession|auth\(|requireAuth|requireUser|currentUser|getUser\(|getCachedSession|verifyToken|jwt\.verify|jwtVerify|authorization|bearer|isAuthenticated|session\b|cookies\(\)|withAuth|authenticate|clerk|passport|x-api-key|timingSafeEqual|signature/i.test(content);
}

function touchesData(content: string) {
  return /prisma\.|\bdb\.|\.query\(|\.insert\(|\.execute\(|supabase|mongoose|sequelize|knex|writeFile|unlink|sendMail|stripe\./i.test(content);
}

export function scanDangerousPatterns(file: ScanFile): RawFinding[] {
  if (file.content === null) return [];
  const { path, content } = file;
  if (isTestPath(path) || /\.min\.js$/i.test(path)) return [];
  const isCode = JS_FILE.test(path) || HTML_FILE.test(path) || PY_FILE.test(path);
  if (!isCode) return [];

  const lines = content.split('\n');
  const out: RawFinding[] = [];

  lines.forEach((line, index) => {
    if (line.length > 2000 || COMMENT_LINE.test(line)) return;
    for (const rule of RULES) {
      if (!applicable(rule, path) || !rule.test(line, { content, index, lines })) continue;
      out.push({
        rule: rule.rule,
        category: 'CODE',
        severity: rule.severity,
        file: path,
        line: index + 1,
        title: rule.title,
        message: rule.message,
        snippet: line.trim().slice(0, 160),
        evidence: line.trim(),
      });
    }
  });

  if (JS_FILE.test(path)) {
    const wildcard = lines.findIndex((l) =>
      !COMMENT_LINE.test(l) &&
      (/Access-Control-Allow-Origin['"]?\s*[,:]\s*['"`]\*['"`]/i.test(l) ||
        /\bcors\s*\(\s*\{[^}]*origin\s*:\s*(?:['"`]\*['"`]|true)/.test(l) ||
        /\borigin\s*:\s*['"`]\*['"`]/.test(l)),
    );
    if (wildcard >= 0) {
      const withCredentials = /Access-Control-Allow-Credentials['"]?\s*[,:]\s*['"`]?true|credentials\s*:\s*true/i.test(content);
      out.push({
        rule: withCredentials ? 'code/cors-wildcard-credentials' : 'code/cors-wildcard',
        category: 'CODE',
        severity: withCredentials ? 'HIGH' : 'MEDIUM',
        file: path,
        line: wildcard + 1,
        title: withCredentials ? 'Wildcard CORS combined with credentials' : 'Wildcard CORS origin',
        message: withCredentials
          ? 'Allowing every origin together with credentials lets any website make authenticated requests as your users. List the exact origins you trust.'
          : 'Access-Control-Allow-Origin: * lets any website read responses from this endpoint. Restrict it to the origins that need access unless the data is fully public.',
        snippet: lines[wildcard].trim().slice(0, 160),
        evidence: lines[wildcard].trim(),
      });
    }

    if (API_ROUTE.test(path) && !hasAuthMarker(content) && touchesData(content)) {
      const mutating = /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b|export\s+const\s+(?:POST|PUT|PATCH|DELETE)\b|\.(?:post|put|patch|delete)\s*\(/.test(content);
      if (mutating) {
        const at = lines.findIndex((l) => /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b|export\s+const\s+(?:POST|PUT|PATCH|DELETE)\b|\.(?:post|put|patch|delete)\s*\(/.test(l));
        out.push({
          rule: 'code/api-route-without-auth',
          category: 'CODE',
          severity: 'MEDIUM',
          file: path,
          line: at >= 0 ? at + 1 : null,
          title: 'API route changes data without a visible authentication check',
          message: 'This route writes data or calls a paid service but no session, token or signature check was found in the file. Heuristic: confirm it is protected (for example by middleware) or add an authentication check.',
          snippet: at >= 0 ? lines[at].trim().slice(0, 160) : undefined,
          evidence: path,
        });
      }
    }
  }

  return out.slice(0, 50);
}
