import { Bars, Donut, Panel, TrendLine } from '@/components/growth-bi/charts';
import { RecommendationsPanel, type RecommendationView } from '@/components/growth-bi/recommendations-panel';
import { decideProjectRecommendationAction, generateProjectRecommendationsAction } from '@/lib/actions/project-growth-insights';
import type { ProjectSnapshot } from '@/lib/growth-bi/project';
import type { EvidenceRow } from '@/lib/growth-bi/recommend';
import { detectAnomaly, FORECAST_LABEL, forecastTrend } from '@/lib/growth-bi/stats';

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
const TH = 'py-1 pr-3 text-left font-normal text-app-text-muted';

type Alert = { id: string; message: string };
type Rec = { id: string; title: string; rationale: string; status: string; proposedAction: unknown; evidence: unknown };

export function ProjectInsights({ projectId, days, snapshot, alerts, recommendations }: { projectId: string; days: number; snapshot: ProjectSnapshot; alerts: Alert[]; recommendations: Rec[] }) {
  const views = snapshot.trend.map((t) => t.views);
  const leads = snapshot.trend.map((t) => t.leads);
  const anomaly = detectAnomaly(views);
  const forecast = forecastTrend(views);
  const t = snapshot.totals;
  const items: RecommendationView[] = recommendations.map((r) => ({
    id: r.id,
    title: r.title,
    rationale: r.rationale,
    status: r.status,
    action: r.proposedAction as RecommendationView['action'],
    evidence: r.evidence as EvidenceRow[],
  }));

  return (
    <section aria-label="Acquisition insights" className="mx-auto mt-8 max-w-6xl space-y-4 px-4 pb-10">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-app-text">Where your visitors and leads come from</h2>
        <a href={`/api/projects/${projectId}/growth/export?days=${days}`} className="rounded-md border border-app-border-subtle px-2 py-1 text-xs text-app-text">Export CSV</a>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[['Page views', t.views], ['Visitors (daily unique)', t.visitors], ['Leads', t.leads], ['Won', t.won], ['Bookings', t.bookings]].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-app-border-subtle bg-app-surface p-3">
            <p className="text-xs text-app-text-muted">{label}</p>
            <p className="mt-1 text-xl font-semibold text-app-text">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Views and leads" hint={`Visit to lead rate ${pct(t.viewToLead)}`}>
            <TrendLine labels={snapshot.trend.map((x) => x.day)} series={[{ name: 'Views', values: views }, { name: 'Leads', values: leads }]} />
            <p className="mt-2 text-xs text-app-text-secondary">
              {forecast.status === 'ok' ? `${FORECAST_LABEL} Views: about ${forecast.total} over the next ${forecast.points.length} days.` : `Forecast unavailable: ${forecast.reason}`}
            </p>
          </Panel>
        </div>
        <Panel title="Leads by channel">
          <Donut centre={String(t.leads)} slices={snapshot.channels.map((c) => ({ name: c.channel, value: c.leads }))} />
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Channels" hint="Views by UTM or referrer; leads by the UTM captured on the form.">
          <table className="w-full text-xs">
            <thead><tr><th className={TH}>Channel</th><th className={TH}>Views</th><th className={TH}>Leads</th><th className={TH}>Won</th><th className={TH}>Bookings</th><th className={TH}>View→lead</th></tr></thead>
            <tbody>
              {snapshot.channels.map((c) => (
                <tr key={c.channel} className="border-t border-app-border-subtle text-app-text"><td className="py-1 pr-3">{c.channel}</td><td>{c.views}</td><td>{c.leads}</td><td>{c.won}</td><td>{c.bookings}</td><td>{pct(c.viewToLead)}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Top campaigns">
          {snapshot.campaigns.length ? <Bars rows={snapshot.campaigns.map((c) => ({ name: c.campaign, value: c.leads }))} /> : <p className="text-xs text-app-text-muted">No leads with a campaign tag yet.</p>}
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Data quality">
          <ul className="list-disc pl-4 text-xs text-app-text-secondary">
            <li>Leads without UTM: {pct(snapshot.untaggedLeadPct)}</li>
            <li>Page views without UTM: {pct(snapshot.untaggedViewPct)}</li>
            <li>
              {anomaly.status === 'anomaly'
                ? `Page views ${anomaly.kind === 'DROP' ? 'dropped' : 'spiked'} yesterday: ${anomaly.observed} vs a typical ${Math.round(anomaly.expected)}.`
                : anomaly.status === 'normal'
                  ? 'No unusual change in page views.'
                  : `Anomaly detection: ${anomaly.reason}`}
            </li>
            <li>{snapshot.retention.reason}</li>
            {alerts.map((a) => <li key={a.id}>{a.message}</li>)}
          </ul>
        </Panel>
        <Panel title="Recommendations" hint="Based only on the aggregated numbers above. Uses marketing credits; you approve any action.">
          <RecommendationsPanel items={items} generate={generateProjectRecommendationsAction.bind(null, projectId)} decide={decideProjectRecommendationAction} note="Each recommendation lists the metrics it relies on." />
        </Panel>
      </div>
    </section>
  );
}
