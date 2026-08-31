import { useEffect, useMemo, useState } from "react";
import { PickCard } from "./components/PickCard";
import { ProfitChart } from "./components/ProfitChart";
import { mockPicks, mockProfitCurve, mockRegionMetrics } from "./data/mockData";
import { calculateTotals, calculateWinRate, formatPercent } from "./lib/metrics";
import { nextModelRun } from "./lib/modelSchedule";
import { supabase } from "./lib/supabase";
import type { Pick, ProfitPoint, RegionMetric } from "./types";

type PageKey = "dashboard" | "picks" | "results" | "model" | "system";
type DataMode = "loading" | "live" | "preview";

const navItems: Array<{ key: PageKey; label: string; short: string }> = [
  { key: "dashboard", label: "Dashboard", short: "DB" },
  { key: "picks", label: "Today's Picks", short: "TP" },
  { key: "results", label: "Results", short: "RS" },
  { key: "model", label: "Model Lab", short: "ML" },
  { key: "system", label: "System Health", short: "SH" },
];

const patternRules = [
  { name: "Rematch within 7 days — O/U reversal", status: "Definition required" },
  { name: "Rematch in 8–14 days — O/U continuation", status: "Experimental · backtest required" },
  { name: "Same venue rematch — price repeat", status: "Experimental · backtest required" },
  { name: "Reversed venue rematch — price recovery", status: "Experimental · backtest required" },
  { name: "Two consecutive 0–0 league draws", status: "Experimental · backtest required" },
  { name: "Three consecutive 1–1 results", status: "Experimental · backtest required" },
  { name: "Two consecutive 2–0 first-half profiles", status: "Experimental · backtest required" },
  { name: "Two red cards with no subsequent goal", status: "Experimental · backtest required" },
  { name: "Club identity / animal-pattern experiment", status: "Definition required" },
  { name: "Manager criticism news signal", status: "Definition required" },
  { name: "New-manager first-match context", status: "Definition required" },
];

interface DashboardPickRow {
  id: string;
  region: Pick["region"];
  country: string;
  competition: string;
  kickoff_at: string;
  session_time: "11:00" | "18:00";
  home_team: string;
  away_team: string;
  market: Pick["market"];
  selection: string;
  line: string | null;
  decimal_odds: number;
  model_probability: number;
  market_probability: number;
  expected_value: number;
  confidence: number;
  data_quality: number;
  risk_flag: Pick["riskFlag"];
  status: Pick["status"];
  signals: string[] | null;
}

interface PerformanceRow {
  region: RegionMetric["region"];
  label: string;
  wins: number;
  losses: number;
  pushes: number;
  profit_units: number;
}

interface ProfitRow {
  result_date: string;
  cumulative_profit: number;
}

interface ResultRow {
  id: string;
  settled_at: string;
  region: string;
  market: string;
  selection: string;
  line: number | null;
  decimal_odds: number;
  result: string;
  profit_units: number;
}

function mapPick(row: DashboardPickRow): Pick {
  return {
    id: row.id,
    region: row.region,
    country: row.country,
    competition: row.competition,
    kickoffAt: row.kickoff_at,
    session: row.session_time,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    market: row.market,
    selection: row.selection,
    line: row.line,
    decimalOdds: Number(row.decimal_odds),
    modelProbability: Number(row.model_probability),
    marketProbability: Number(row.market_probability),
    expectedValue: Number(row.expected_value),
    confidence: row.confidence,
    dataQuality: row.data_quality,
    riskFlag: row.risk_flag,
    status: row.status,
    signals: row.signals ?? [],
  };
}

function App() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const [picks, setPicks] = useState<Pick[]>(mockPicks);
  const [regionMetrics, setRegionMetrics] = useState<RegionMetric[]>([]);
  const [profitCurve, setProfitCurve] = useState<ProfitPoint[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [dataMode, setDataMode] = useState<DataMode>("loading");
  const displayedMetrics = dataMode === "live" ? regionMetrics : mockRegionMetrics;
  const displayedCurve = dataMode === "live"
    ? (profitCurve.length > 0 ? profitCurve : [{ label: "No results", value: 0 }])
    : mockProfitCurve;
  const totals = useMemo(() => calculateTotals(displayedMetrics), [displayedMetrics]);
  const winRate = calculateWinRate(totals.wins, totals.losses);
  const graded = totals.wins + totals.losses;
  const roi = graded === 0 ? 0 : (totals.profitUnits / graded) * 100;

  useEffect(() => {
    let active = true;
    async function loadPicks() {
      const [pickResponse, metricResponse, curveResponse, resultResponse] = await Promise.all([
        supabase.from("public_current_picks").select("*").order("kickoff_at"),
        supabase.from("public_performance_summary").select("*").order("region"),
        supabase.from("public_profit_curve").select("*").order("result_date"),
        supabase.from("public_results").select("*").order("settled_at", { ascending: false }).limit(100),
      ]);
      if (!active) return;
      if (!pickResponse.error && pickResponse.data) {
        setPicks((pickResponse.data as DashboardPickRow[]).map(mapPick));
        setRegionMetrics(
          metricResponse.error || !metricResponse.data
            ? []
            : (metricResponse.data as PerformanceRow[]).map((row) => ({
                region: row.region,
                label: row.label,
                wins: row.wins,
                losses: row.losses,
                pushes: row.pushes,
                profitUnits: Number(row.profit_units),
              })),
        );
        setProfitCurve(
          curveResponse.error || !curveResponse.data
            ? []
            : (curveResponse.data as ProfitRow[]).map((row) => ({
                label: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Bangkok" }).format(new Date(`${row.result_date}T12:00:00+07:00`)),
                value: Number(row.cumulative_profit),
              })),
        );
        setResults(resultResponse.error || !resultResponse.data ? [] : resultResponse.data as ResultRow[]);
        setDataMode("live");
      } else {
        setDataMode("preview");
      }
    }
    void loadPicks();
    return () => { active = false; };
  }, []);

  const modeText = dataMode === "live" ? "Supabase live" : dataMode === "loading" ? "Connecting" : "Preview data";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">S</div>
        <nav aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={page === item.key ? "nav-item nav-item--active" : "nav-item"}
              onClick={() => setPage(item.key)}
              title={item.label}
            >
              <span>{item.short}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-status" title="System online"><span /></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="wordmark">
            <strong>SOCEZ</strong><span>GLOBAL</span>
          </div>
          <div className="topbar-actions">
            <span className={`data-mode data-mode--${dataMode}`}><i />{modeText}</span>
            <span className="timezone">UTC+7 · Bangkok</span>
          </div>
        </header>

        {page === "dashboard" && (
          <div className="page">
            <section className="page-heading">
              <div>
                <span className="eyebrow">GLOBAL FOOTBALL INTELLIGENCE</span>
                <h1>Investment overview</h1>
                <p>Pattern-led signals, market-normalized probabilities and auditable results.</p>
              </div>
              <div className="next-run"><span>Next model run</span><strong>{nextModelRun()}</strong><small>Bangkok time</small></div>
            </section>

            <section className="metric-grid">
              <article className="metric-card metric-card--hero">
                <span>Total P/L</span><strong>+{totals.profitUnits.toFixed(1)} U</strong><small>Flat stake · 1 unit</small>
              </article>
              <article className="metric-card"><span>Win rate</span><strong>{formatPercent(winRate)}</strong><small>{totals.wins}W · {totals.losses}L · {totals.pushes}P</small></article>
              <article className="metric-card"><span>ROI</span><strong>+{formatPercent(roi)}</strong><small>Graded picks only</small></article>
              <article className="metric-card"><span>Open picks</span><strong>{picks.length}</strong><small>Qualified selections</small></article>
              <article className="metric-card"><span>Max drawdown</span><strong>-2.4 U</strong><small>Current model version</small></article>
            </section>

            <section className="dashboard-grid">
              <article className="panel panel--chart">
                <div className="panel-heading"><div><span className="eyebrow">PERFORMANCE</span><h2>Cumulative profit</h2></div><span className="trend-up">+3.7 U this week</span></div>
                <ProfitChart points={displayedCurve} />
              </article>
              <article className="panel region-panel">
                <div className="panel-heading"><div><span className="eyebrow">REGIONAL EDGE</span><h2>Win rate by region</h2></div></div>
                <div className="region-list">
                  {displayedMetrics.map((metric) => {
                    const rate = calculateWinRate(metric.wins, metric.losses);
                    return <div className="region-row" key={metric.region}><div><strong>{metric.label}</strong><span>{metric.wins + metric.losses} graded</span></div><div className="rate-track"><i style={{ width: `${rate}%` }} /></div><strong>{formatPercent(rate)}</strong></div>;
                  })}
                </div>
              </article>
            </section>

            <section className="section-heading"><div><span className="eyebrow">TODAY</span><h2>Qualified picks</h2></div><button onClick={() => setPage("picks")}>View all picks →</button></section>
            {picks.length > 0 ? <div className="pick-grid">{picks.slice(0, 3).map((pick) => <PickCard key={pick.id} pick={pick} />)}</div> : <NoPicks />}
          </div>
        )}

        {page === "picks" && <SimplePage title="Today's SOCEZ Final Picks" eyebrow="11:00 + 18:00 SESSIONS" description="A Final Pick requires verified evidence from at least one SOCEZ rule plus market, freshness and value confirmation.">{picks.length > 0 ? <div className="pick-grid">{picks.map((pick) => <PickCard key={pick.id} pick={pick} />)}</div> : <NoPicks />}</SimplePage>}

        {page === "results" && <SimplePage title="Results explorer" eyebrow="AUDITABLE SETTLEMENT" description="Day, month and year filters read graded results from Supabase."><ResultsTable results={results} preview={dataMode !== "live"} /></SimplePage>}

        {page === "model" && <SimplePage title="SOCEZ 11-rule model lab" eyebrow="FINAL PICK HARD GATE" description="Market-only candidates remain private. A public Final Pick must include verified evidence from at least one SOCEZ rule."><div className="rule-grid">{patternRules.map((rule, index) => <article key={rule.name}><span>RULE {String(index + 1).padStart(2, "0")}</span><strong>{rule.name}</strong><small>{rule.status}</small></article>)}</div></SimplePage>}

        {page === "system" && <SimplePage title="System health" eyebrow="AUTOMATION CONTROL" description="Cron history, data freshness and provider status will be visible here."><div className="health-grid"><HealthItem label="Supabase database" status="Healthy" detail="Singapore · ap-southeast-1" /><HealthItem label="11:00 model run" status="Not scheduled" detail="Migration required" /><HealthItem label="18:00 model run" status="Not scheduled" detail="Migration required" /><HealthItem label="06:00 settlement" status="Not scheduled" detail="Migration required" /><HealthItem label="Football data provider" status="Not configured" detail="API adapter pending" /><HealthItem label="LINE notification" status="Not configured" detail="Channel token pending" /></div></SimplePage>}
      </main>
    </div>
  );
}

function SimplePage({ title, eyebrow, description, children }: { title: string; eyebrow: string; description: string; children: React.ReactNode }) {
  return <div className="page"><section className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></section>{children}</div>;
}

function NoPicks() {
  return <div className="empty-state"><strong>No SOCEZ Final Pick</strong><span>No fixture has passed a verified SOCEZ 1–11 rule with market confirmation. Market-only candidates are retained privately for research and are never published as Final Picks.</span></div>;
}

function HealthItem({ label, status, detail }: { label: string; status: string; detail: string }) {
  const healthy = status === "Healthy";
  return <article className="health-item"><i className={healthy ? "health-dot health-dot--ok" : "health-dot"} /><div><strong>{label}</strong><span>{detail}</span></div><small>{status}</small></article>;
}

function ResultsTable({ results, preview }: { results: ResultRow[]; preview: boolean }) {
  const previewRows: ResultRow[] = [
    { id: "preview-1", settled_at: "2026-08-29T12:00:00Z", region: "Europe", market: "AH", selection: "Home", line: -0.25, decimal_odds: 1.94, result: "FULL_WIN", profit_units: 0.94 },
    { id: "preview-2", settled_at: "2026-08-29T12:00:00Z", region: "Asia", market: "OU", selection: "Over", line: 2.25, decimal_odds: 1.91, result: "PUSH", profit_units: 0 },
    { id: "preview-3", settled_at: "2026-08-28T12:00:00Z", region: "Americas", market: "1X2", selection: "Home", line: null, decimal_odds: 2.08, result: "FULL_LOSS", profit_units: -1 },
  ];
  const rows = preview ? previewRows : results;
  if (rows.length === 0) return <div className="empty-state"><strong>No settled results</strong><span>Results will appear after the first qualified pick has been graded.</span></div>;
  return <div className="results-panel"><div className="filter-bar"><button className="filter-active">7 days</button><button>30 days</button><button>Year</button><span>All regions · All markets</span></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Region</th><th>Market</th><th>Selection</th><th>Odds</th><th>Result</th><th>P/L</th></tr></thead><tbody>{rows.map((row) => {
    const resultClass = row.result.includes("WIN") ? "win" : row.result === "PUSH" ? "push" : "loss";
    return <tr key={row.id}><td>{new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Bangkok" }).format(new Date(row.settled_at))}</td><td>{row.region}</td><td>{row.market}</td><td>{row.selection} {row.line ?? ""}</td><td>{Number(row.decimal_odds).toFixed(2)}</td><td><span className={`result result--${resultClass}`}>{row.result.replace("FULL_", "")}</span></td><td className={row.profit_units > 0 ? "positive" : row.profit_units < 0 ? "negative" : ""}>{row.profit_units > 0 ? "+" : ""}{Number(row.profit_units).toFixed(2)} U</td></tr>;
  })}</tbody></table></div>{preview && <p className="preview-note">Illustrative records — live results appear after settlement.</p>}</div>;
}

export default App;
