import { describe, expect, it } from 'vitest';

import {
  deriveFeatureStatus,
  detectFeatureCandidates,
  isConfirmedAbsent,
  validateSummaries,
} from './features';
import { buildInventory } from './inventory';

const files = [
  { path: 'web/package.json', content: JSON.stringify({ dependencies: { next: '16', react: '19', stripe: '1' } }) },
  { path: 'web/app/page.tsx', content: 'export default function Home(){return <a href="/pricing">Pricing</a>}' },
  { path: 'web/app/pricing/page.tsx', content: 'export default function P(){return null}' },
  { path: 'web/app/(shop)/cart/page.tsx', content: 'export default function C(){return null}' },
  { path: 'web/app/api/checkout/route.ts', content: "import Stripe from 'stripe';\nexport const POST = () => new Stripe('x')" },
  { path: 'web/components/ContactForm.tsx', content: 'export const F = () => <form><input /></form>' },
  { path: 'web/lib/util.ts', content: 'export const x = 1' },
];

describe('buildInventory', () => {
  it('detects framework, routes, api endpoints and modules from paths', () => {
    const inv = buildInventory(files);
    expect(inv.framework).toBe('Next.js');
    expect(inv.pages).toEqual(['/', '/cart', '/pricing']);
    expect(inv.apiEndpoints).toEqual(['/api/checkout']);
    expect(inv.modules.map((m) => m.name)).toEqual(expect.arrayContaining(['app', 'components', 'lib']));
  });

  it('detects static HTML sites', () => {
    const inv = buildInventory([{ path: 's/index.html' }, { path: 's/about.html' }]);
    expect(inv.framework).toBe('Static HTML');
    expect(inv.pages).toEqual(['/', '/about']);
  });
});

describe('detectFeatureCandidates', () => {
  const candidates = detectFeatureCandidates(files);
  const get = (key: string) => candidates.find((c) => c.key === key);

  it('finds Stripe present with file evidence and PayPal absent with scan evidence', () => {
    expect(get('payments-stripe')?.present).toBe(true);
    expect(get('payments-stripe')?.evidence[0]).toMatchObject({ type: 'file', ref: 'web/app/api/checkout/route.ts' });
    const paypal = get('payments-paypal');
    expect(paypal?.present).toBe(false);
    expect(paypal?.evidence[0].type).toBe('scan_absent');
    expect(paypal?.evidence[0].detail).toMatch(/Scanned 7 source files/);
  });

  it('does not claim absence when no file contents were scanned', () => {
    const none = detectFeatureCandidates([{ path: 'a/app/page.tsx' }]);
    expect(none.find((c) => c.key === 'payments-paypal')).toBeUndefined();
  });

  it('detects forms and cart routes', () => {
    expect(get('contact-form')?.present).toBe(true);
    expect(get('cart-checkout')?.present).toBe(true);
  });
});

describe('deriveFeatureStatus', () => {
  const file = [{ type: 'file' as const, ref: 'a', detail: '' }];
  const base = { evidence: file, deployedCurrent: false, smokePassedForDeployment: false, hasOpenIssue: false };

  it('keeps features without file evidence PLANNED, even if deployed or documented', () => {
    expect(
      deriveFeatureStatus({
        ...base,
        evidence: [{ type: 'knowledge', ref: 'k', detail: '' }],
        deployedCurrent: true,
        smokePassedForDeployment: true,
      }),
    ).toBe('PLANNED');
  });

  it('progresses IMPLEMENTED -> DEPLOYED -> TESTED and lets issues override', () => {
    expect(deriveFeatureStatus(base)).toBe('IMPLEMENTED');
    expect(deriveFeatureStatus({ ...base, deployedCurrent: true })).toBe('DEPLOYED');
    expect(deriveFeatureStatus({ ...base, deployedCurrent: true, smokePassedForDeployment: true })).toBe('TESTED');
    expect(deriveFeatureStatus({ ...base, deployedCurrent: true, hasOpenIssue: true })).toBe('KNOWN_ISSUE');
  });
});

describe('isConfirmedAbsent', () => {
  it('requires a scan record and no file evidence', () => {
    const scan = [{ type: 'scan_absent', ref: 'scan', detail: '' }];
    expect(isConfirmedAbsent({ status: 'PLANNED', evidence: scan })).toBe(true);
    expect(isConfirmedAbsent({ status: 'PLANNED', evidence: [] })).toBe(false);
    expect(isConfirmedAbsent({ status: 'IMPLEMENTED', evidence: scan })).toBe(false);
  });
});

describe('validateSummaries', () => {
  const candidates = detectFeatureCandidates(files);
  it('keeps summaries that cite real evidence refs and drops invented ones', () => {
    const result = validateSummaries(
      candidates,
      JSON.stringify({
        features: [
          { key: 'payments-stripe', summary: 'Takes card payments via Stripe.', refs: ['web/app/api/checkout/route.ts'] },
          { key: 'contact-form', summary: 'Invented.', refs: ['web/nonexistent.ts'] },
          { key: 'unknown', summary: 'x', refs: ['y'] },
          { key: 'auth', summary: 'No refs' , refs: [] },
        ],
      }),
    );
    expect([...result.keys()]).toEqual(['payments-stripe']);
  });

  it('returns nothing for malformed output', () => {
    expect(validateSummaries(candidates, 'not json').size).toBe(0);
  });
});
