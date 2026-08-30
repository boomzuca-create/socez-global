import type { Pick } from "../types";

function formatKickoff(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

export function PickCard({ pick }: { pick: Pick }) {
  const edge = ((pick.modelProbability - pick.marketProbability) * 100).toFixed(1);

  return (
    <article className="pick-card">
      <div className="pick-card__topline">
        <span className="eyebrow">{pick.competition}</span>
        <span className={`risk risk--${pick.riskFlag.toLowerCase()}`}>{pick.riskFlag}</span>
      </div>
      <div className="fixture-row">
        <div>
          <strong>{pick.homeTeam}</strong>
          <span>vs {pick.awayTeam}</span>
        </div>
        <div className="kickoff">
          <strong>{formatKickoff(pick.kickoffAt)}</strong>
          <span>Bangkok</span>
        </div>
      </div>
      <div className="selection-box">
        <div>
          <span>Final pick</span>
          <strong>
            {pick.selection} {pick.line ?? ""}
          </strong>
        </div>
        <div className="odds">
          <span>{pick.market}</span>
          <strong>@{pick.decimalOdds.toFixed(2)}</strong>
        </div>
      </div>
      <div className="pick-metrics">
        <div><span>Confidence</span><strong>{pick.confidence}</strong></div>
        <div><span>Data quality</span><strong>{pick.dataQuality}</strong></div>
        <div><span>Model edge</span><strong>+{edge}%</strong></div>
        <div><span>Expected value</span><strong>+{(pick.expectedValue * 100).toFixed(1)}%</strong></div>
      </div>
      <div className="signal-list">
        {pick.signals.map((signal) => <span key={signal}>{signal}</span>)}
      </div>
    </article>
  );
}
