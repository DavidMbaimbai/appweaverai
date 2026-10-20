import { ActivationForm, RollupButton, UtmBuilder } from '@/components/admin/growth/admin-controls';
import { AdminPageHeader, KpiCard, formatCurrencyCents, formatNumber } from '@/components/admin/ui/primitives';
import { Bars, Donut, Panel, Sparkline, TrendLine } from '@/components/growth-bi/charts';
import { RecommendationsPanel, type RecommendationView } from '@/components/growth-bi/recommendations-panel';
import { decidePlatformRecommendationAction, generatePlatformRecommendationsAction } from '@/lib/admin/actions/growth';
import { requireAdmin } from '@/lib/auth/require-admin';
import { hasPermission } from '@/lib/admin/permissions';
import { getActivationConfig, collectPlatform, platformCatalog } from '@/lib/growth-bi/platform';
import { dataSufficiency, type EvidenceRow } from '@/lib/growth-bi/recommend';
import { lastDays, PLATFORM_SCOPE, seriesFor } from '@/lib/growth-bi/rollup';
import { listRecommendations } from '@/lib/growth-bi/service';
import { forecastTrend, FORECAST_LABEL, type AcquisitionCost, type Measured } from '@/lib/growth-bi/stats';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
const measured = (m: Measured, fmt: (n: number) => string) => (m.status === 'ok' ? fmt(m.value) : <span title={m.reason} className="text-app-text-muted">Insufficient data</span>);
const money = (n: number) => formatCurrencyCents(Math.round(n));
const TH = 'py-1 pr-3 text-left font-normal text-app-text-muted';

export default async function AdminGrowthPage({ searchParams }: { searchParams: Promise<{ model?: string; days?: string }> }) {
  const auth = await requireAdmin('growth:read');
  if (!auth.ok) return null;
  const canWrite = hasPermission(auth.admin.adminRole, 'growth:write');
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const model = sp.model === 'last' ? 'last' : 'first';
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const trendDays = lastDays(28);

  const [snap, activation, links, alerts, recs, visits, signups, activations, paid] = await Promise.all([
    collectPlatform(from, to, model),
    getActivationConfig(),
    prisma.growthLink.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.growthAlert.findMany({ where: { scopeType: PLATFORM_SCOPE }, orderBy: { day: 'desc' }, take: 6 }),
    listRecommendations('PLATFORM', PLATFORM_SCOPE),
    seriesFor(PLATFORM_SCOPE, PLATFORM_SCOPE, 'visits', trendDays),
    seriesFor(PLATFORM_SCOPE, PLATFORM_SCOPE, 'signups', trendDays),
    seriesFor(PLATFORM_SCOPE, PLATFORM_SCOPE, 'activations', trendDays),
    seriesFor(PLATFORM_SCOPE, PLATFORM_SCOPE, 'paid', trendDays),
  ]);
  const all = snap.funnel.all;
  const forecast = forecastTrend(signups);
  const sufficiency = dataSufficiency('PLATFORM', platformCatalog(snap));
  const recViews: RecommendationView[] = recs.map((r) => ({
    id: r.id,
    title: r.title,
    rationale: r.rationale,
    status: r.status,
    action: r.proposedAction as RecommendationView['action'],
    evidence: r.evidence as unknown as EvidenceRow[],
  }));

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Growth attribution"
        description={`AppWeaver's own acquisition funnel. Activation = ${snap.activation}. Revenue and MRR live under Revenue.`}
        actions={
          <div className="flex items-center gap-3 text-xs">
            {[7, 30, 90].map((d) => (
              <a key={d} href={`?days=${d}&model=${model}`} className={d === days ? 'font-semibold text-app-text' : 'text-app-text-secondary'}>{d}d</a>
            ))}
            <a href={`?days=${days}&model=${model === 'first' ? 'last' : 'first'}`} className="rounded-md border border-app-border-subtle px-2 py-1 text-app-text">
              {model === 'first' ? 'First touch' : 'Last touch'}
            </a>
            <a href={`/api/admin/growth/export?days=${days}&model=${model}`} className="rounded-md border border-app-border-subtle px-2 py-1 text-app-text">Export CSV</a>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Visitors (consented)', value: all.visitors == null ? '—' : formatNumber(all.visitors), series: visits },
          { label: 'Signups', value: formatNumber(all.signups), series: signups, hint: `Visitor to signup ${pct(all.visitorToSignup)}` },
          { label: 'Activated', value: formatNumber(all.activated), series: activations, hint: `Of signups ${pct(all.signupToActivated)}` },
          { label: 'Paid', value: formatNumber(all.paid), series: paid, hint: `Of activated ${pct(all.activatedToPaid)}` },
        ].map((k) => (
          <div key={k.label}>
            <KpiCard label={k.label} value={k.value} hint={k.hint} />
            <div className="px-2"><Sparkline values={k.series} label={`${k.label} last 28 days`} /></div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Trend, last 28 days" hint="From nightly rollups. Run the rollup below if this is empty.">
            <TrendLine labels={trendDays} series={[{ name: 'Visits', values: visits }, { name: 'Signups', values: signups }, { name: 'Activations', values: activations }]} />
            <div className="mt-3 text-xs text-app-text-secondary">
              {forecast.status === 'ok' ? (
                <p>
                  {FORECAST_LABEL} Signups: about {forecast.total} over the next {forecast.points.length} days ({forecast.slopePerDay >= 0 ? '+' : ''}{Math.round(forecast.slopePerDay * 100) / 100}/day trend).
                </p>
              ) : (
                <p>Forecast unavailable: {forecast.reason}</p>
              )}
            </div>
          </Panel>
        </div>
        <Panel title="Signups by channel" hint={model === 'first' ? 'First-touch attribution' : 'Last-touch attribution'}>
          <Donut centre={String(all.signups)} slices={snap.funnel.byChannel.map((c) => ({ name: c.key, value: c.signups }))} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Conversion by channel" hint="Untracked = signups without consented attribution; their visitor rate is not computed.">
          <table className="w-full text-xs">
            <thead><tr><th className={TH}>Channel</th><th className={TH}>Visitors</th><th className={TH}>Signups</th><th className={TH}>Activated</th><th className={TH}>Paid</th><th className={TH}>Visit→signup</th></tr></thead>
            <tbody>
              {snap.funnel.byChannel.map((c) => (
                <tr key={c.key} className="border-t border-app-border-subtle text-app-text">
                  <td className="py-1 pr-3">{c.key}</td><td>{c.visitors ?? '—'}</td><td>{c.signups}</td><td>{c.activated}</td><td>{c.paid}</td><td>{pct(c.visitorToSignup)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Conversion by campaign">
          <table className="w-full text-xs">
            <thead><tr><th className={TH}>Campaign</th><th className={TH}>Signups</th><th className={TH}>Activated</th><th className={TH}>Paid</th></tr></thead>
            <tbody>
              {snap.funnel.byCampaign.slice(0, 12).map((c) => (
                <tr key={c.key} className="border-t border-app-border-subtle text-app-text"><td className="py-1 pr-3">{c.key}</td><td>{c.signups}</td><td>{c.activated}</td><td>{c.paid}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3"><Bars rows={snap.campaignKinds.map((k) => ({ name: k.kind, value: k.signups }))} /></div>
        </Panel>
      </div>

      <Panel title="Marketing spend vs results" hint={snap.spend.note}>
        <div className="grid grid-cols-2 gap-3 text-xs text-app-text sm:grid-cols-4">
          <div>Spend (ads + internal)<p className="text-lg font-semibold">{formatCurrencyCents(snap.blended.spendCents)}</p></div>
          <div>CAC<p className="text-lg font-semibold">{measured(snap.blended.cac, money)}</p></div>
          <div>Cost per activation<p className="text-lg font-semibold">{measured(snap.blended.costPerActivation, money)}</p></div>
          <div>ROAS<p className="text-lg font-semibold">{measured(snap.blended.roas, (n) => `${Math.round(n * 100) / 100}x`)}</p></div>
        </div>
        {snap.costs.length ? (
          <table className="mt-3 w-full text-xs">
            <thead><tr><th className={TH}>Channel</th><th className={TH}>Spend</th><th className={TH}>Signups</th><th className={TH}>Paid</th><th className={TH}>CAC</th><th className={TH}>ROAS</th></tr></thead>
            <tbody>
              {snap.costs.map((c: { channel: string; cost: AcquisitionCost; signups: number; paid: number }) => (
                <tr key={c.channel} className="border-t border-app-border-subtle text-app-text">
                  <td className="py-1 pr-3">{c.channel}</td><td>{formatCurrencyCents(c.cost.spendCents)}</td><td>{c.signups}</td><td>{c.paid}</td><td>{measured(c.cost.cac, money)}</td><td>{measured(c.cost.roas, (n) => `${Math.round(n * 100) / 100}x`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Weekly cohorts" hint="Share of each cohort with real activity in each week after signup. Blank = week not yet complete.">
          <table className="w-full text-xs">
            <thead><tr><th className={TH}>Cohort</th><th className={TH}>Size</th>{snap.cohortsWeekly[0]?.retention.map((_, i) => <th key={i} className={TH}>W{i}</th>)}<th className={TH}>Churn</th></tr></thead>
            <tbody>
              {snap.cohortsWeekly.map((c) => (
                <tr key={c.cohort} className="border-t border-app-border-subtle text-app-text">
                  <td className="py-1 pr-3">{c.cohort}</td><td>{c.size}</td>
                  {c.retention.map((r, i) => <td key={i}>{r?.rate == null ? '' : pct(r.rate)}</td>)}
                  <td>{pct(c.churnRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Feature usage" hint="Distinct users per tracked product event.">
          {snap.features.length ? <Bars rows={snap.features.map((f) => ({ name: `${f.name} (${f.uses} uses)`, value: f.users }))} /> : <p className="text-xs text-app-text-muted">No feature events recorded in this period.</p>}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Data health" hint="How trustworthy the attribution is.">
          <p className="text-2xl font-semibold text-app-text">{snap.health.score == null ? 'Not enough data' : `${snap.health.score}/100`}</p>
          <ul className="mt-2 list-disc pl-4 text-xs text-app-text-secondary">
            <li>Visits missing UTM: {pct(snap.health.missingUtmPct)}</li>
            <li>Signups without attribution: {pct(snap.health.untrackedSignupPct)}</li>
            <li>Campaigns without a recorded link: {pct(snap.health.unrecordedLinkPct)}</li>
            {snap.health.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </Panel>
        <Panel title="Anomaly alerts">
          {alerts.length ? (
            <ul className="space-y-1 text-xs text-app-text-secondary">{alerts.map((a) => <li key={a.id}>{a.message}</li>)}</ul>
          ) : (
            <p className="text-xs text-app-text-muted">No anomalies detected. Detection needs 14+ days of rollups.</p>
          )}
          {canWrite ? <div className="mt-3"><RollupButton /></div> : null}
        </Panel>
      </div>

      <Panel title="Recommendations" hint="Generated only from aggregated metrics; each cites its evidence. Approving records a decision, nothing executes automatically.">
        {sufficiency.ok ? null : <p className="mb-2 text-xs text-app-text-muted">Not enough data yet: {sufficiency.reason}</p>}
        {canWrite ? (
          <RecommendationsPanel items={recViews} generate={generatePlatformRecommendationsAction} decide={decidePlatformRecommendationAction} note="Internal AppWeaver analysis: no customer credits are charged." />
        ) : null}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="UTM link builder" hint="Every generated link is recorded so campaigns can be attributed.">
          {canWrite ? <UtmBuilder /> : null}
          <ul className="mt-3 space-y-1 text-[11px] text-app-text-muted">{links.map((l) => <li key={l.id} className="break-all">{l.kind}: {l.url}</li>)}</ul>
        </Panel>
        <Panel title="Activation definition">
          {canWrite ? <ActivationForm requireBuild={activation.requireBuild} output={activation.output} /> : <p className="text-xs">{snap.activation}</p>}
        </Panel>
      </div>
    </div>
  );
}
