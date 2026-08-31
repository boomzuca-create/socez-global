export type SettlementResult =
  | "FULL_WIN"
  | "HALF_WIN"
  | "PUSH"
  | "HALF_LOSS"
  | "FULL_LOSS";

const EPSILON = 1e-9;

export function settleOneXTwo(
  selection: "HOME" | "DRAW" | "AWAY",
  homeGoals: number,
  awayGoals: number,
): SettlementResult {
  const outcome = homeGoals > awayGoals ? "HOME" : homeGoals < awayGoals ? "AWAY" : "DRAW";
  return selection === outcome ? "FULL_WIN" : "FULL_LOSS";
}

function settleSingleAsianLine(value: number): SettlementResult {
  if (value > EPSILON) return "FULL_WIN";
  if (value < -EPSILON) return "FULL_LOSS";
  return "PUSH";
}

function splitQuarterLine(line: number): [number, number] {
  const doubled = line * 2;
  return [Math.floor(doubled) / 2, Math.ceil(doubled) / 2];
}

function combineHalves(first: SettlementResult, second: SettlementResult): SettlementResult {
  const value: Record<SettlementResult, number> = {
    FULL_WIN: 1,
    HALF_WIN: 0.5,
    PUSH: 0,
    HALF_LOSS: -0.5,
    FULL_LOSS: -1,
  };
  const combined = (value[first] + value[second]) / 2;
  if (combined > 0.75) return "FULL_WIN";
  if (combined > 0.25) return "HALF_WIN";
  if (combined > -0.25) return "PUSH";
  if (combined > -0.75) return "HALF_LOSS";
  return "FULL_LOSS";
}

export function settleAsianHandicap(
  selection: "HOME" | "AWAY",
  line: number,
  homeGoals: number,
  awayGoals: number,
): SettlementResult {
  const margin = selection === "HOME" ? homeGoals - awayGoals : awayGoals - homeGoals;
  const [lower, upper] = splitQuarterLine(line);
  return combineHalves(
    settleSingleAsianLine(margin + lower),
    settleSingleAsianLine(margin + upper),
  );
}

export function settleTotal(
  selection: "OVER" | "UNDER",
  line: number,
  homeGoals: number,
  awayGoals: number,
): SettlementResult {
  const totalGoals = homeGoals + awayGoals;
  const [lower, upper] = splitQuarterLine(line);
  const direction = selection === "OVER" ? 1 : -1;
  return combineHalves(
    settleSingleAsianLine((totalGoals - lower) * direction),
    settleSingleAsianLine((totalGoals - upper) * direction),
  );
}

export function settleMarket(
  market: "1X2" | "AH" | "OU",
  selection: string,
  line: number | null,
  homeGoals: number,
  awayGoals: number,
): SettlementResult {
  if (market === "1X2" && ["HOME", "DRAW", "AWAY"].includes(selection)) {
    return settleOneXTwo(selection as "HOME" | "DRAW" | "AWAY", homeGoals, awayGoals);
  }
  if (market === "AH" && line !== null && ["HOME", "AWAY"].includes(selection)) {
    return settleAsianHandicap(selection as "HOME" | "AWAY", line, homeGoals, awayGoals);
  }
  if (market === "OU" && line !== null && ["OVER", "UNDER"].includes(selection)) {
    return settleTotal(selection as "OVER" | "UNDER", line, homeGoals, awayGoals);
  }
  throw new Error(`Unsupported settlement selection: ${market}/${selection}/${line ?? "NO_LINE"}`);
}

export function profitUnits(result: SettlementResult, decimalOdds: number, stakeUnits: number): number {
  if (result === "FULL_WIN") return stakeUnits * (decimalOdds - 1);
  if (result === "HALF_WIN") return stakeUnits * (decimalOdds - 1) / 2;
  if (result === "PUSH") return 0;
  if (result === "HALF_LOSS") return -stakeUnits / 2;
  return -stakeUnits;
}

export function pickStatus(result: SettlementResult): "WIN" | "LOSS" | "PUSH" {
  if (result === "FULL_WIN" || result === "HALF_WIN") return "WIN";
  if (result === "FULL_LOSS" || result === "HALF_LOSS") return "LOSS";
  return "PUSH";
}
