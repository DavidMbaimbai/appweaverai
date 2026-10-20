import { describe, expect, it } from 'vitest';

import { scanDangerousPatterns } from './patterns';
import { scanQuality } from './quality';
import { scanFiles } from './scan';
import { scanSecrets } from './secrets';
import type { ScanFile } from './types';

const file = (path: string, content: string, size = content.length): ScanFile => ({ path, size, content });
const rules = (findings: { rule: string }[]) => findings.map((f) => f.rule);

// Fixture credentials are assembled at runtime so no real-looking key literal lives in the repo.
const STRIPE_LIVE = ['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('_');
const AWS_KEY = 'AKIA' + 'IOSFODNN7EXAMPLQ';
const GH_TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';

describe('secret scanner', () => {
  it('detects known provider keys and never echoes the full value', () => {
    const findings = scanSecrets(
      file('lib/billing.ts', `const a = "${STRIPE_LIVE}";\nconst b = "${AWS_KEY}";\nconst c = "${GH_TOKEN}";`),
    );
    expect(rules(findings)).toEqual(
      expect.arrayContaining(['secret/stripe-live-key', 'secret/aws-access-key', 'secret/github-token']),
    );
    for (const f of findings) expect(`${f.snippet}${f.message}`).not.toContain(STRIPE_LIVE);
    expect(findings.find((f) => f.rule === 'secret/stripe-live-key')?.line).toBe(1);
  });

  it('detects private keys and database URLs with credentials', () => {
    const findings = scanSecrets(
      file('lib/db.ts', `const url = "postgres://admin:hunter2pass@db.example.com:5432/app";\n// -----BEGIN RSA PRIVATE KEY-----`),
    );
    expect(rules(findings)).toEqual(expect.arrayContaining(['secret/database-url', 'secret/private-key']));
  });

  it('flags server secrets referenced from client components as HIGH or worse', () => {
    const findings = scanSecrets(
      file('app/page.tsx', `'use client';\nconst key = process.env.STRIPE_SECRET_KEY;\nconst p = process.env.NEXT_PUBLIC_API_SECRET;`),
    );
    expect(rules(findings)).toEqual(expect.arrayContaining(['secret/server-env-in-client', 'secret/public-env-secret']));
    expect(findings.every((f) => ['HIGH', 'CRITICAL'].includes(f.severity))).toBe(true);
  });

  it('flags a high-entropy credential assigned in client code as HIGH', () => {
    const findings = scanSecrets(file('public/app.js', `const apiKey = "q8Zx3Kd92LmPw7Rt5VbN1cHs4Yf6";`));
    expect(findings.find((f) => f.rule === 'secret/high-entropy-assignment')?.severity).toBe('HIGH');
  });

  it('does not flag placeholders, env reads, local database URLs, or test files', () => {
    expect(
      scanSecrets(
        file(
          'lib/config.ts',
          [
            'const apiKey = process.env.API_KEY;',
            'const placeholder = "your-api-key-here";',
            `const example = "${'sk_' + 'live_'}xxxxxxxxxxxxxxxxxxxxxxxx";`,
            'const local = "postgres://postgres:postgres@localhost:5432/app";',
            'const title = "Welcome to our shop";',
          ].join('\n'),
        ),
      ),
    ).toEqual([]);
    expect(scanSecrets(file('lib/billing.test.ts', `const token = "q8Zx3Kd92LmPw7Rt5VbN1cHs4Yf6";`))).toEqual([]);
  });

  it('ignores lockfiles full of integrity hashes', () => {
    const lock = `{"packages":{"a":{"integrity":"sha512-q8Zx3Kd92LmPw7Rt5VbN1cHs4Yf6q8Zx3Kd92LmPw7Rt5VbN1cHs4Yf6=="}}}`;
    expect(scanSecrets(file('package-lock.json', lock))).toEqual([]);
  });

  it('notes a committed .env file', () => {
    expect(rules(scanSecrets(file('.env', 'FOO=bar')))).toContain('secret/env-file-present');
  });
});

describe('dangerous pattern scanner', () => {
  const scan = (path: string, content: string) => rules(scanDangerousPatterns(file(path, content)));

  it('detects eval, new Function and string timers', () => {
    expect(scan('a.js', 'eval(userInput);')).toContain('code/eval');
    expect(scan('a.js', 'const f = new Function("a", body);')).toContain('code/new-function');
    expect(scan('a.js', 'setTimeout("doThing()", 100);')).toContain('code/string-timer');
  });

  it('detects dynamic dangerouslySetInnerHTML but not static literals', () => {
    expect(scan('c.tsx', 'return <div dangerouslySetInnerHTML={{ __html: comment.body }} />;')).toContain(
      'code/dangerously-set-inner-html',
    );
    expect(scan('c.tsx', 'return <div dangerouslySetInnerHTML={{ __html: "<b>static</b>" }} />;')).not.toContain(
      'code/dangerously-set-inner-html',
    );
  });

  it('detects SQL built by concatenation or interpolation but not parameterised or tagged queries', () => {
    expect(scan('db.ts', 'db.query("SELECT * FROM users WHERE id = " + req.query.id);')).toContain('code/sql-concatenation');
    expect(scan('db.ts', 'db.query(`SELECT * FROM users WHERE id = ${id}`);')).toContain('code/sql-concatenation');
    expect(scan('db.ts', 'db.query("SELECT * FROM users WHERE id = $1", [id]);')).not.toContain('code/sql-concatenation');
    expect(scan('db.ts', 'await sql`SELECT * FROM users WHERE id = ${id}`;')).not.toContain('code/sql-concatenation');
  });

  it('detects command execution with dynamic input', () => {
    expect(scan('x.js', 'exec(`convert ${req.body.name} out.png`);')).toContain('code/command-injection');
    expect(scan('x.js', 'exec("ls -la");')).not.toContain('code/command-injection');
  });

  it('detects open redirects from request data only', () => {
    expect(scan('r.ts', 'return NextResponse.redirect(req.nextUrl.searchParams.get("next"));')).toContain(
      'code/open-redirect',
    );
    expect(scan('r.ts', 'return NextResponse.redirect(new URL("/login", req.url));')).not.toContain('code/open-redirect');
  });

  it('detects wildcard CORS, rating credentials higher', () => {
    const open = scanDangerousPatterns(file('app/api/x/route.ts', `headers: { 'Access-Control-Allow-Origin': '*' }`));
    expect(open.find((f) => f.rule.startsWith('code/cors'))?.severity).toBe('MEDIUM');
    const creds = scanDangerousPatterns(
      file('app/api/x/route.ts', `res.setHeader('Access-Control-Allow-Origin', '*');\nres.setHeader('Access-Control-Allow-Credentials', 'true');`),
    );
    expect(creds.find((f) => f.rule.startsWith('code/cors'))?.severity).toBe('HIGH');
  });

  it('detects hardcoded passwords but not input types or env reads', () => {
    expect(scan('auth.ts', 'const password = "SuperSecret123!";')).toContain('code/hardcoded-password');
    expect(scan('form.tsx', '<input type="password" name="password" />')).not.toContain('code/hardcoded-password');
    expect(scan('auth.ts', 'const password = process.env.DB_PASSWORD;')).not.toContain('code/hardcoded-password');
  });

  it('detects insecure http requests but not localhost or XML namespaces', () => {
    expect(scan('api.ts', 'await fetch("http://api.example.com/data");')).toContain('code/insecure-http-request');
    expect(scan('api.ts', 'await fetch("http://localhost:3000/data");')).not.toContain('code/insecure-http-request');
    expect(scan('icon.tsx', '<svg xmlns="http://www.w3.org/2000/svg" />')).not.toContain('code/insecure-http-request');
  });

  it('flags API routes that never check auth, but not ones that do', () => {
    const open = 'export async function POST(req) { const body = await req.json(); await db.item.create({ data: body }); }';
    expect(scan('app/api/items/route.ts', open)).toContain('code/api-route-without-auth');
    const guarded = 'export async function POST(req) { const session = await auth(); if (!session) return new Response(null, { status: 401 }); }';
    expect(scan('app/api/items/route.ts', guarded)).not.toContain('code/api-route-without-auth');
  });

  it('skips comments and test files', () => {
    expect(scan('a.js', '// eval(userInput)')).toEqual([]);
    expect(scan('a.test.ts', 'eval(userInput);')).toEqual([]);
  });
});

describe('quality scanner', () => {
  const scan = (path: string, content: string, size?: number) => rules(scanQuality(file(path, content, size)));

  it('flags images without alt and buttons without a name', () => {
    expect(scan('index.html', '<html lang="en"><body><img src="a.png"></body></html>')).toContain('a11y/img-alt');
    expect(scan('c.tsx', 'return <button onClick={go}></button>;')).toContain('a11y/button-name');
  });

  it('accepts images with alt and buttons with text or aria-label', () => {
    const ok = scan('c.tsx', 'return <div><img src="a.png" alt="Logo" width={10} height={10} /><button>Save</button><button aria-label="Close" /></div>;');
    expect(ok).not.toContain('a11y/img-alt');
    expect(ok).not.toContain('a11y/button-name');
  });

  it('flags large unoptimised assets by size', () => {
    const big = scanQuality({ path: 'public/hero.png', size: 4 * 1024 * 1024, content: null });
    expect(big.some((f) => f.category === 'PERFORMANCE')).toBe(true);
    expect(scanQuality({ path: 'public/icon.png', size: 20 * 1024, content: null })).toEqual([]);
  });
});

describe('scanFiles', () => {
  it('combines scanners, ignores node_modules, orders by severity and keeps fingerprints stable across line shifts', async () => {
    const body = `const key = "${STRIPE_LIVE}";\neval(x);`;
    const first = await scanFiles(
      [file('lib/a.ts', body), file('node_modules/pkg/index.js', 'eval(x)')],
      { skipDependencies: true },
    );
    const shifted = await scanFiles([file('lib/a.ts', `\n\n${body}`)], { skipDependencies: true });
    expect(first.findings.some((f) => f.file.startsWith('node_modules'))).toBe(false);
    expect(first.findings[0].severity).toBe('CRITICAL');
    expect(shifted.findings.map((f) => f.fingerprint).sort()).toEqual(first.findings.map((f) => f.fingerprint).sort());
    expect(first.dependencies.status).toBe('SKIPPED');
  });
});
