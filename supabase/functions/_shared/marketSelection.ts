export type MarketCode = "1X2" | "AH" | "OU";

export interface MarketSnapshot {
  bookmakerId: string;
  reliabilityWeight: number;
  market: MarketCode;
  selection: string;
  line: number | null;
  decimalOdds: number;
  capturedAt: string;
}

export interface RankedCandidate {
  market: MarketCode;
  selection: string;
  line: number | null;
  decimalOdds: number;
  modelProbability: number;
  marketProbability: number;
  expectedValue: number;
  score: number;
  riskFlag: "GREEN" | "YELLOW" | "RED";
  tier: "QUALIFIED" | "CONDITIONAL" | "BEST_AVAILABLE";
  bookmakerCount: number;
  priceCapturedAt: string;
  criteria: {
    marketValue: number;
    consensus: number;
    bookmakerCoverage: number;
    dataQuality: number;
    priceFreshness: number;
  };
  signals: string[];
}

const clamp = (value: number, minimum = 0, maximum = 100) =>
  Math.min(maximum, Math.max(minimum, value));

function marketGroup(snapshot: MarketSnapshot): string | null {
  if (snapshot.market === "1X2") return "1X2";
  if (snapshot.line === null) return null;
  if (snapshot.market === "OU") return `OU:${Math.abs(snapshot.line).toFixed(2)}`;
  const homeLine = snapshot.selection === "HOME" ? snapshot.line : -snapshot.line;
  return `AH:${homeLine.toFixed(2)}`;
}

function expectedSelections(market: MarketCode): string[] {
  if (market === "1X2") return ["HOME", "DRAW", "AWAY"];
  if (market === "OU") return ["OVER", "UNDER"];
  return ["HOME", "AWAY"];
}

function freshnessScore(capturedAt: string, now: Date): number {
  const ageMinutes = Math.max(0, (now.getTime() - new Date(capturedAt).getTime()) / 60_000);
  if (ageMinutes <= 15) return 100;
  if (ageMinutes <= 60) return 80;
  if (ageMinutes <= 180) return 60;
  return 30;
}

export function rankMarketCandidates(
  snapshots: MarketSnapshot[],
  dataQuality: number,
  now = new Date(),
): RankedCandidate[] {
  const latest = new Map<string, MarketSnapshot>();
  for (const snapshot of snapshots) {
    const group = marketGroup(snapshot);
    if (!group || !Number.isFinite(snapshot.decimalOdds) || snapshot.decimalOdds <= 1) continue;
    const key = [snapshot.bookmakerId, group, snapshot.selection].join("|");
    const current = latest.get(key);
    if (!current || new Date(snapshot.capturedAt) > new Date(current.capturedAt)) latest.set(key, snapshot);
  }

  const bookmakerGroups = new Map<string, MarketSnapshot[]>();
  for (const snapshot of latest.values()) {
    const group = marketGroup(snapshot);
    if (!group) continue;
    const key = `${snapshot.bookmakerId}|${group}`;
    bookmakerGroups.set(key, [...(bookmakerGroups.get(key) ?? []), snapshot]);
  }

  type FairObservation = { probability: number; weight: number; row: MarketSnapshot };
  const observations = new Map<string, FairObservation[]>();
  for (const rows of bookmakerGroups.values()) {
    const market = rows[0].market;
    const required = expectedSelections(market);
    if (!required.every((selection) => rows.some((row) => row.selection === selection))) continue;
    const selectedRows = required.map((selection) => rows.find((row) => row.selection === selection)!);
    const overround = selectedRows.reduce((total, row) => total + 1 / row.decimalOdds, 0);
    if (overround <= 0) continue;
    for (const row of selectedRows) {
      const group = marketGroup(row)!;
      const key = `${group}|${row.selection}`;
      const item = { probability: (1 / row.decimalOdds) / overround, weight: row.reliabilityWeight, row };
      observations.set(key, [...(observations.get(key) ?? []), item]);
    }
  }

  const safeDataQuality = Math.round(clamp(dataQuality));
  return [...observations.values()].map((items) => {
    const weightTotal = items.reduce((total, item) => total + item.weight, 0);
    const modelProbability = items.reduce((total, item) => total + item.probability * item.weight, 0) / weightTotal;
    const variance = items.reduce(
      (total, item) => total + item.weight * (item.probability - modelProbability) ** 2,
      0,
    ) / weightTotal;
    const best = items.reduce((winner, item) => item.row.decimalOdds > winner.row.decimalOdds ? item : winner);
    const expectedValue = modelProbability * best.row.decimalOdds - 1;
    const criteria = {
      marketValue: Math.round(clamp(50 + expectedValue * 1_000)),
      consensus: Math.round(clamp(100 - Math.sqrt(variance) * 400)),
      bookmakerCoverage: Math.round(clamp((items.length / 3) * 100)),
      dataQuality: safeDataQuality,
      priceFreshness: freshnessScore(best.row.capturedAt, now),
    };
    const score = Math.round(
      criteria.marketValue * 0.30 +
      criteria.consensus * 0.20 +
      criteria.bookmakerCoverage * 0.20 +
      criteria.dataQuality * 0.20 +
      criteria.priceFreshness * 0.10,
    );
    const tier = score >= 75 ? "QUALIFIED" : score >= 70 ? "CONDITIONAL" : "BEST_AVAILABLE";
    return {
      market: best.row.market,
      selection: best.row.selection,
      line: best.row.line,
      decimalOdds: best.row.decimalOdds,
      modelProbability,
      marketProbability: 1 / best.row.decimalOdds,
      expectedValue,
      score,
      riskFlag: score >= 80 ? "GREEN" : score >= 70 ? "YELLOW" : "RED",
      tier,
      bookmakerCount: items.length,
      priceCapturedAt: best.row.capturedAt,
      criteria,
      signals: [
        `Market value ${criteria.marketValue}%`,
        `Consensus ${criteria.consensus}%`,
        `Bookmaker coverage ${criteria.bookmakerCoverage}%`,
        `Data quality ${criteria.dataQuality}%`,
        `Price freshness ${criteria.priceFreshness}%`,
      ],
    } satisfies RankedCandidate;
  }).sort((left, right) => right.score - left.score || right.expectedValue - left.expectedValue);
}

export function selectPublishedCandidates(candidates: RankedCandidate[], maximum?: number): RankedCandidate[] {
  const rankedQualified = candidates.filter((candidate) => candidate.score >= 70);
  const qualified = maximum === undefined ? rankedQualified : rankedQualified.slice(0, maximum);
  return qualified.length > 0 ? qualified : candidates.slice(0, 1);
}
